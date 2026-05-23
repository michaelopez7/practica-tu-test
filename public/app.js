const state = {
  files: [],
  testData: null,
  answers: [],
  essayEvals: {},
  shuffledOrders: {},
  orderingSelection: [],
  currentQuestion: 0,
  timerEnabled: false,
  timerMinutes: 10,
  timerInterval: null,
  timerSeconds: 0,
  context: { language: 'Auto', examType: 'academico', questionTypes: ['multiple_choice'], notes: '' },
  feedbackData: null
};

const DAILY_LIMIT = 5;

function getUsage() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('ptt_usage') || '{}');
  if (stored.date !== today) return { date: today, count: 0 };
  return stored;
}
function incrementUsage() {
  const usage = getUsage(); usage.count += 1;
  localStorage.setItem('ptt_usage', JSON.stringify(usage));
  updateUsageBadge();
}
function getRemainingTests() { return Math.max(0, DAILY_LIMIT - getUsage().count); }
function updateUsageBadge() {
  const el = document.getElementById('usageCount');
  if (el) el.textContent = getRemainingTests();
}

function goTo(screenId) {
  const current = document.querySelector('.screen.active');
  const next = document.getElementById(screenId);
  if (!next || current === next) return;
  current.classList.add('exit');
  setTimeout(() => current.classList.remove('active', 'exit'), 300);
  next.classList.add('active');
  next.scrollTop = 0;
}

function handleFiles(files) {
  for (const file of files) {
    if (!state.files.find(f => f.name === file.name)) state.files.push(file);
  }
  renderFilePreviews();
}
function renderFilePreviews() {
  const container = document.getElementById('filePreviews');
  if (state.files.length === 0) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  container.innerHTML = state.files.map((f, i) => {
    const icon = f.type.startsWith('image/') ? '🖼️' : '📝';
    return `<div class="file-chip"><span>${icon}</span><span class="file-name">${f.name}</span><button class="remove-file" onclick="removeFile(${i})">×</button></div>`;
  }).join('');
}
function removeFile(i) { state.files.splice(i, 1); renderFilePreviews(); }
function handleDrop(e) { e.preventDefault(); document.getElementById('uploadZone').classList.remove('drag-over'); handleFiles(e.dataTransfer.files); }
function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag-over'); }
function handleDragLeave() { document.getElementById('uploadZone').classList.remove('drag-over'); }

document.querySelectorAll('.option-pills').forEach(group => {
  group.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
  });
});

document.querySelectorAll('.qtype-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const active = document.querySelectorAll('.qtype-chip.active');
    if (chip.classList.contains('active') && active.length === 1) return;
    chip.classList.toggle('active');
  });
});

document.getElementById('contentText').addEventListener('input', function () {
  document.getElementById('charCount').textContent = this.value.length + ' caracteres';
});

function toggleTimer() {
  const enabled = document.getElementById('timerToggle').checked;
  state.timerEnabled = enabled;
  const opts = document.getElementById('timerOptions');
  if (enabled) opts.classList.remove('hidden');
  else opts.classList.add('hidden');
}

function goToContext() {
  const text = document.getElementById('contentText').value.trim();
  if (!text && state.files.length === 0) {
    showToast('Agrega texto o sube un archivo primero.', 'error');
    return;
  }
  goTo('screen-context');
}

async function generateTest() {
  if (getRemainingTests() <= 0) { showToast('Limite diario alcanzado. Vuelve manana.', 'error'); return; }

  const text = document.getElementById('contentText').value.trim();
  const numQuestions = document.querySelector('#numQuestions .pill.active')?.dataset.value || '10';
  const difficulty = document.querySelector('#difficulty .pill.active')?.dataset.value || 'medio';
  state.timerMinutes = parseInt(document.querySelector('#timerMinutes .pill.active')?.dataset.value || '10');

  const language = document.querySelector('#contextLanguage .pill.active')?.dataset.value || 'Auto';
  const examType = document.querySelector('#contextExamType .pill.active')?.dataset.value || 'academico';
  const questionTypes = [...document.querySelectorAll('.qtype-chip.active')].map(c => c.dataset.value);
  const notes = document.getElementById('contextNotes').value.trim();
  state.context = { language, examType, questionTypes, notes };

  goTo('screen-loading');
  animateLoadingSteps();

  try {
    const contentParts = [];
    for (const file of state.files) {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        contentParts.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: base64.split(',')[1] } });
      } else if (file.type === 'text/plain') {
        contentParts.push({ type: 'text', text: await file.text() });
      }
    }
    if (text) contentParts.push({ type: 'text', text });

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: contentParts, numQuestions, difficulty, ...state.context })
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Error desconocido');

    incrementUsage();
    state.testData = data;
    state.answers = new Array(data.questions.length).fill(null);
    state.essayEvals = {};
    state.shuffledOrders = {};
    state.orderingSelection = [];
    state.currentQuestion = 0;
    state.feedbackData = null;

    await delay(500);
    renderTest();
    goTo('screen-test');
    if (state.timerEnabled) startTimer();

  } catch (err) {
    await delay(300);
    goTo('screen-context');
    showToast(err.message || 'Error al generar el test.', 'error');
  }
}

function startTimer() {
  state.timerSeconds = state.timerMinutes * 60;
  const display = document.getElementById('timerDisplay');
  display.classList.remove('hidden', 'warning');
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerSeconds--;
    updateTimerDisplay();
    if (state.timerSeconds <= 60) display.classList.add('warning');
    if (state.timerSeconds <= 0) {
      clearInterval(state.timerInterval);
      showToast('Tiempo agotado!', 'error');
      showResults();
    }
  }, 1000);
}
function stopTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  document.getElementById('timerDisplay').classList.add('hidden');
}
function updateTimerDisplay() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  document.getElementById('timerText').textContent = m + ':' + (s < 10 ? '0' : '') + s;
}

function animateLoadingSteps() {
  const steps = ['step1', 'step2', 'step3', 'step4'];
  const subtitles = ['Analizando el contenido...', 'Extrayendo conceptos clave...', 'Creando preguntas variadas...', 'Casi listo!'];
  steps.forEach(id => document.getElementById(id).classList.remove('active', 'done'));
  steps.forEach((id, i) => {
    setTimeout(() => {
      if (i > 0) { document.getElementById(steps[i - 1]).classList.remove('active'); document.getElementById(steps[i - 1]).classList.add('done'); }
      document.getElementById(id).classList.add('active');
      document.getElementById('loadingSubtitle').textContent = subtitles[i];
    }, i * 1800);
  });
}

function renderTest() {
  document.getElementById('topicBadge').textContent = state.testData.topic;
  renderQuestion();
}

const TYPE_LABELS = {
  multiple_choice: 'Selección múltiple',
  true_false: 'Verdadero / Falso',
  fill_blank: 'Completar espacio',
  ordering: 'Ordenar',
  essay: 'Respuesta abierta',
  math: 'Matemático'
};

function isRevealed(idx) {
  const q = state.testData.questions[idx];
  const a = state.answers[idx];
  if (a === null || a === undefined) return false;
  if (q.type === 'essay') return !!state.essayEvals[idx];
  return true;
}

function renderQuestion() {
  const { questions } = state.testData;
  const q = questions[state.currentQuestion];
  const total = questions.length;
  const current = state.currentQuestion + 1;
  const revealed = isRevealed(state.currentQuestion);

  document.getElementById('progressText').textContent = current + ' / ' + total;
  document.getElementById('progressFill').style.width = ((current / total) * 100) + '%';
  document.getElementById('questionNumber').textContent = 'Pregunta ' + current;
  document.getElementById('questionText').textContent = q.question;

  const typeBadge = document.getElementById('questionTypeBadge');
  const type = q.type || 'multiple_choice';
  if (type !== 'multiple_choice') {
    typeBadge.textContent = TYPE_LABELS[type] || type;
    typeBadge.style.display = 'inline-block';
  } else {
    typeBadge.style.display = 'none';
  }

  const container = document.getElementById('optionsList');
  container.innerHTML = '';

  if (type === 'multiple_choice') renderMC(container, q, revealed);
  else if (type === 'true_false') renderTF(container, q, revealed);
  else if (type === 'fill_blank') renderFillBlank(container, q, revealed);
  else if (type === 'ordering') renderOrdering(container, q, revealed);
  else if (type === 'essay') renderEssay(container, q, revealed);
  else if (type === 'math') renderMath(container, q, revealed);
  else renderMC(container, q, revealed);

  if (revealed) {
    const box = document.createElement('div');
    box.className = 'explanation-box';
    box.innerHTML = '<strong>Explicación:</strong> ' + q.explanation;
    container.appendChild(box);
  }

  document.getElementById('prevBtn').style.visibility = current > 1 ? 'visible' : 'hidden';
  document.getElementById('nextBtn').disabled = !revealed;
  document.getElementById('nextBtnText').textContent = current === total ? 'Ver resultados' : 'Siguiente';

  const card = document.getElementById('questionCard');
  card.style.opacity = '0';
  card.style.transform = 'translateY(10px)';
  requestAnimationFrame(() => {
    card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  });
}

function renderMC(container, q, revealed) {
  const letters = ['A', 'B', 'C', 'D'];
  const saved = state.answers[state.currentQuestion];
  q.options.forEach((opt, i) => {
    let cls = '';
    if (revealed) { if (i === q.correct) cls = 'correct'; else if (i === saved) cls = 'wrong'; }
    else if (i === saved) cls = 'selected';
    const btn = document.createElement('button');
    btn.className = 'option-btn ' + cls;
    btn.disabled = revealed;
    btn.onclick = () => selectMC(i);
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt}</span>`;
    container.appendChild(btn);
  });
}
function selectMC(index) {
  if (isRevealed(state.currentQuestion)) return;
  state.answers[state.currentQuestion] = index;
  renderQuestion();
}

function renderTF(container, q, revealed) {
  const saved = state.answers[state.currentQuestion];
  [true, false].forEach(val => {
    const label = val ? 'Verdadero' : 'Falso';
    const icon = val ? '✓' : '✗';
    let cls = '';
    if (revealed) { if (val === q.correct) cls = 'correct'; else if (val === saved) cls = 'wrong'; }
    else if (val === saved) cls = 'selected';
    const btn = document.createElement('button');
    btn.className = 'tf-btn ' + cls;
    btn.disabled = revealed;
    btn.onclick = () => selectTF(val);
    btn.innerHTML = `<span class="tf-icon">${icon}</span><span>${label}</span>`;
    container.appendChild(btn);
  });
}
function selectTF(val) {
  if (isRevealed(state.currentQuestion)) return;
  state.answers[state.currentQuestion] = val;
  renderQuestion();
}

function renderFillBlank(container, q, revealed) {
  const saved = state.answers[state.currentQuestion];
  if (revealed) {
    const isCorrect = saved && saved.toLowerCase().trim() === (q.answer || '').toLowerCase().trim();
    const div = document.createElement('div');
    div.className = 'open-result ' + (isCorrect ? 'correct' : 'wrong');
    div.innerHTML = `
      <div class="open-result-row"><span class="open-result-label">Tu respuesta:</span><span>${saved || '(sin respuesta)'}</span></div>
      ${!isCorrect ? `<div class="open-result-row"><span class="open-result-label correct-label">Correcta:</span><span class="correct-label">${q.answer}</span></div>` : ''}
    `;
    container.appendChild(div);
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'open-answer-wrapper';
    wrapper.innerHTML = `
      <input type="text" class="open-answer-input" id="fillBlankInput" placeholder="Escribe tu respuesta aquí..." autocomplete="off" />
      <button class="btn-primary btn-full" style="margin-top:10px" onclick="submitFillBlank()">Comprobar respuesta</button>
    `;
    container.appendChild(wrapper);
    setTimeout(() => {
      const input = document.getElementById('fillBlankInput');
      if (input) { input.focus(); input.addEventListener('keypress', e => { if (e.key === 'Enter') submitFillBlank(); }); }
    }, 50);
  }
}
function submitFillBlank() {
  const input = document.getElementById('fillBlankInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) { showToast('Escribe una respuesta primero.', 'error'); return; }
  state.answers[state.currentQuestion] = val;
  renderQuestion();
}

function renderOrdering(container, q, revealed) {
  const saved = state.answers[state.currentQuestion];
  if (revealed) {
    const header = document.createElement('div');
    header.className = 'ordering-revealed-header';
    header.textContent = 'Orden correcto:';
    container.appendChild(header);
    q.items.forEach((item, correctPos) => {
      const userPos = (saved || []).indexOf(correctPos);
      const isCorrect = userPos === correctPos;
      const div = document.createElement('div');
      div.className = 'ordering-result-item ' + (isCorrect ? 'correct' : 'wrong');
      div.innerHTML = `<span class="order-num">${correctPos + 1}</span><span class="order-text">${item}</span>${!isCorrect && userPos !== -1 ? `<span class="order-user-note">pusiste en pos. ${userPos + 1}</span>` : ''}`;
      container.appendChild(div);
    });
    return;
  }

  if (!state.shuffledOrders[state.currentQuestion]) {
    const indices = q.items.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    state.shuffledOrders[state.currentQuestion] = indices;
  }

  const displayOrder = state.shuffledOrders[state.currentQuestion];
  const selected = state.orderingSelection;

  const hint = document.createElement('p');
  hint.className = 'ordering-hint';
  hint.textContent = 'Toca los elementos en el orden correcto (1° primero)';
  container.appendChild(hint);

  const itemsDiv = document.createElement('div');
  itemsDiv.className = 'ordering-items';
  displayOrder.forEach(originalIdx => {
    const pos = selected.indexOf(originalIdx);
    const isSelected = pos !== -1;
    const btn = document.createElement('button');
    btn.className = 'ordering-item' + (isSelected ? ' selected' : '');
    btn.disabled = isSelected;
    btn.onclick = () => selectOrderItem(originalIdx);
    btn.innerHTML = `<span class="order-badge">${isSelected ? pos + 1 : '?'}</span><span>${q.items[originalIdx]}</span>`;
    itemsDiv.appendChild(btn);
  });
  container.appendChild(itemsDiv);

  if (selected.length > 0) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-ghost ordering-reset';
    resetBtn.textContent = 'Reiniciar orden';
    resetBtn.onclick = resetOrdering;
    container.appendChild(resetBtn);
  }
  if (selected.length === q.items.length) {
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-primary btn-full';
    confirmBtn.style.marginTop = '12px';
    confirmBtn.textContent = 'Confirmar orden';
    confirmBtn.onclick = confirmOrdering;
    container.appendChild(confirmBtn);
  }
}
function selectOrderItem(originalIdx) { state.orderingSelection.push(originalIdx); renderQuestion(); }
function resetOrdering() { state.orderingSelection = []; renderQuestion(); }
function confirmOrdering() { state.answers[state.currentQuestion] = [...state.orderingSelection]; state.orderingSelection = []; renderQuestion(); }

function renderEssay(container, q, revealed) {
  const saved = state.answers[state.currentQuestion];
  const evalResult = state.essayEvals[state.currentQuestion];

  if (revealed && evalResult) {
    const isCorrect = evalResult.score >= 0.7;
    const div = document.createElement('div');
    div.className = 'essay-result';
    div.innerHTML = `
      <div class="essay-user-answer"><span class="open-result-label">Tu respuesta:</span><p>${saved}</p></div>
      <div class="eval-feedback ${isCorrect ? 'correct' : 'wrong'}">
        <span class="eval-score-badge ${isCorrect ? 'correct' : 'wrong'}">${Math.round(evalResult.score * 100)}%</span>
        <p>${evalResult.feedback}</p>
      </div>
      <div class="model-answer-box"><span class="open-result-label">Respuesta modelo:</span><p>${q.modelAnswer}</p></div>
    `;
    container.appendChild(div);
    return;
  }
  if (saved && !evalResult) {
    const loading = document.createElement('div');
    loading.className = 'eval-loading';
    loading.innerHTML = '<div class="feedback-spinner"></div><span>Evaluando tu respuesta...</span>';
    container.appendChild(loading);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'open-answer-wrapper';
  wrapper.innerHTML = `
    <textarea class="open-answer-textarea" id="essayInput" placeholder="Escribe tu respuesta aquí..." rows="5"></textarea>
    <button class="btn-primary btn-full" style="margin-top:10px" onclick="submitEssay()">Enviar respuesta</button>
  `;
  container.appendChild(wrapper);
}
function submitEssay() {
  const input = document.getElementById('essayInput');
  if (!input) return;
  const val = input.value.trim();
  if (val.length < 10) { showToast('Escribe una respuesta más completa.', 'error'); return; }
  state.answers[state.currentQuestion] = val;
  renderQuestion();
  evaluateEssay(state.currentQuestion, val);
}
async function evaluateEssay(qIdx, userAnswer) {
  const q = state.testData.questions[qIdx];
  try {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, modelAnswer: q.modelAnswer, keyPoints: q.keyPoints, userAnswer })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Error evaluando');
    state.essayEvals[qIdx] = data;
  } catch (err) {
    state.essayEvals[qIdx] = { score: 0.5, correct: false, feedback: 'No se pudo evaluar automaticamente. Compara con la respuesta modelo.' };
  }
  if (state.currentQuestion === qIdx) renderQuestion();
}

function renderMath(container, q, revealed) {
  const saved = state.answers[state.currentQuestion];
  const normalize = s => String(s).toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  if (revealed) {
    const isCorrect = saved && normalize(saved) === normalize(q.answer || '');
    const div = document.createElement('div');
    div.className = 'open-result ' + (isCorrect ? 'correct' : 'wrong');
    div.innerHTML = `
      <div class="open-result-row"><span class="open-result-label">Tu respuesta:</span><span>${saved || '(sin respuesta)'}</span></div>
      <div class="open-result-row"><span class="open-result-label correct-label">Correcta:</span><span class="correct-label">${q.answer}</span></div>
      ${q.steps ? `<div class="math-steps"><strong>Solución paso a paso:</strong><p>${q.steps}</p></div>` : ''}
    `;
    container.appendChild(div);
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'open-answer-wrapper';
    wrapper.innerHTML = `
      <input type="text" class="open-answer-input" id="mathInput" placeholder="Escribe tu resultado..." autocomplete="off" />
      <button class="btn-primary btn-full" style="margin-top:10px" onclick="submitMath()">Comprobar</button>
    `;
    container.appendChild(wrapper);
    setTimeout(() => {
      const input = document.getElementById('mathInput');
      if (input) { input.focus(); input.addEventListener('keypress', e => { if (e.key === 'Enter') submitMath(); }); }
    }, 50);
  }
}
function submitMath() {
  const input = document.getElementById('mathInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) { showToast('Escribe tu respuesta primero.', 'error'); return; }
  state.answers[state.currentQuestion] = val;
  renderQuestion();
}

function nextQuestion() {
  if (state.currentQuestion === state.testData.questions.length - 1) { showResults(); return; }
  state.currentQuestion++;
  state.orderingSelection = [];
  renderQuestion();
}
function prevQuestion() {
  if (state.currentQuestion === 0) return;
  state.currentQuestion--;
  state.orderingSelection = [];
  renderQuestion();
}

function getAnswerScore(q, a, idx) {
  if (a === null || a === undefined) return false;
  const type = q.type || 'multiple_choice';
  if (type === 'multiple_choice') return a === q.correct;
  if (type === 'true_false') return a === q.correct;
  if (type === 'fill_blank') return a.toLowerCase().trim() === (q.answer || '').toLowerCase().trim();
  if (type === 'ordering') return Array.isArray(a) && a.every((val, i) => val === i);
  if (type === 'essay') return state.essayEvals[idx] && state.essayEvals[idx].score >= 0.7;
  if (type === 'math') {
    const n = s => String(s).toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
    return n(a) === n(q.answer || '');
  }
  return false;
}
function formatUserAnswer(q, a) {
  if (a === null || a === undefined) return 'Sin responder';
  const type = q.type || 'multiple_choice';
  if (type === 'multiple_choice') return q.options[a] || String(a);
  if (type === 'true_false') return a ? 'Verdadero' : 'Falso';
  if (type === 'ordering') return Array.isArray(a) ? a.map(i => q.items[i]).join(' → ') : String(a);
  return String(a);
}
function formatCorrectAnswer(q) {
  const type = q.type || 'multiple_choice';
  if (type === 'multiple_choice') return q.options[q.correct] || '';
  if (type === 'true_false') return q.correct ? 'Verdadero' : 'Falso';
  if (type === 'fill_blank' || type === 'math') return q.answer || '';
  if (type === 'ordering') return q.items.join(' → ');
  if (type === 'essay') return q.modelAnswer || '';
  return '';
}

function showResults() {
  stopTimer();
  const { questions } = state.testData;
  const score = state.answers.filter((a, i) => getAnswerScore(questions[i], a, i)).length;
  const total = questions.length;
  const pct = score / total;

  document.getElementById('scoreNumber').textContent = score;
  document.getElementById('scoreTotalLabel').textContent = total;

  let title, subtitle;
  if (pct >= 0.9) { title = 'Excelente'; subtitle = 'Dominas este tema.'; }
  else if (pct >= 0.7) { title = 'Muy bien'; subtitle = 'Buen dominio. Repasa los fallos.'; }
  else if (pct >= 0.5) { title = 'Vas por buen camino'; subtitle = 'Sigue practicando, casi lo tienes.'; }
  else { title = 'A estudiar mas'; subtitle = 'Repasa el material y vuelve a intentarlo.'; }

  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSubtitle').textContent = subtitle;

  const circle = document.getElementById('scoreCircle');
  const circumference = 439.82;
  circle.style.strokeDashoffset = circumference;
  setTimeout(() => { circle.style.transition = 'stroke-dashoffset 1s ease'; circle.style.strokeDashoffset = circumference * (1 - pct); }, 300);

  document.getElementById('answersReview').innerHTML = questions.map((q, i) => {
    const a = state.answers[i];
    const isCorrect = getAnswerScore(q, a, i);
    const userAnsText = formatUserAnswer(q, a);
    const correctAnsText = formatCorrectAnswer(q);
    return `<div class="review-item ${isCorrect ? 'correct-item' : 'wrong-item'}">
      <div class="review-header"><div class="review-icon ${isCorrect ? 'ok' : 'fail'}">${isCorrect ? '✓' : '✗'}</div><p class="review-q">${q.question}</p></div>
      <div class="review-answer">
        ${!isCorrect ? `<span class="wrong-label">Tu respuesta: ${userAnsText}</span><br />` : ''}
        <span class="correct-label">Correcta: ${correctAnsText}</span>
      </div>
      <p class="review-explanation">${q.explanation}</p>
    </div>`;
  }).join('');

  goTo('screen-results');
  generateFeedback(questions, score, total);
}

async function generateFeedback(questions, score, total) {
  const wrongQuestions = questions.map((q, i) => ({
    question: q.question,
    userAnswer: formatUserAnswer(q, state.answers[i]),
    correctAnswer: formatCorrectAnswer(q),
    isCorrect: getAnswerScore(q, state.answers[i], i)
  })).filter(q => !q.isCorrect);

  document.getElementById('feedbackLoading').classList.remove('hidden');
  document.getElementById('feedbackCard').classList.add('hidden');

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: state.testData.topic, wrongQuestions, score, total })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error);
    state.feedbackData = data;
    renderFeedback(data);
  } catch (err) {
    document.getElementById('feedbackLoading').classList.add('hidden');
  }
}

function renderFeedback(data) {
  document.getElementById('feedbackLoading').classList.add('hidden');
  document.getElementById('feedbackCard').classList.remove('hidden');
  document.getElementById('feedbackSummary').textContent = data.summary || '';

  const areasEl = document.getElementById('feedbackAreas');
  areasEl.innerHTML = data.weakAreas && data.weakAreas.length > 0
    ? `<p class="feedback-group-label">Puntos a repasar:</p><ul class="feedback-list">${data.weakAreas.map(a => `<li>${a}</li>`).join('')}</ul>`
    : '';

  const recsEl = document.getElementById('feedbackRecs');
  recsEl.innerHTML = data.recommendations && data.recommendations.length > 0
    ? `<p class="feedback-group-label">Recomendaciones:</p><ul class="feedback-list recs">${data.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>`
    : '';

  document.getElementById('feedbackEncouragement').textContent = data.encouragement || '';
}

function retryTest() {
  stopTimer();
  state.answers = new Array(state.testData.questions.length).fill(null);
  state.essayEvals = {};
  state.shuffledOrders = {};
  state.orderingSelection = [];
  state.currentQuestion = 0;
  state.feedbackData = null;
  const circle = document.getElementById('scoreCircle');
  circle.style.transition = 'none';
  circle.style.strokeDashoffset = 439.82;
  renderTest();
  goTo('screen-test');
  if (state.timerEnabled) startTimer();
}

function resetApp() {
  stopTimer();
  state.files = []; state.testData = null; state.answers = [];
  state.essayEvals = {}; state.shuffledOrders = {}; state.orderingSelection = [];
  state.currentQuestion = 0; state.feedbackData = null;
  document.getElementById('contentText').value = '';
  document.getElementById('charCount').textContent = '0 caracteres';
  document.getElementById('filePreviews').innerHTML = '';
  document.getElementById('filePreviews').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  document.getElementById('timerToggle').checked = false;
  document.getElementById('timerOptions').classList.add('hidden');
  document.getElementById('contextNotes').value = '';
  state.timerEnabled = false;
  const circle = document.getElementById('scoreCircle');
  circle.style.transition = 'none';
  circle.style.strokeDashoffset = 439.82;
  goTo('screen-landing');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function showToast(msg, type = '') {
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 3500);
}

updateUsageBadge();
