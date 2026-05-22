const state = {
  files: [],
  testData: null,
  answers: [],
  currentQuestion: 0,
  timerEnabled: false,
  timerMinutes: 10,
  timerInterval: null,
  timerSeconds: 0
};

const DAILY_LIMIT = 5;

// ===== RATE LIMIT =====
function getUsage() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem('ptt_usage') || '{}');
  if (stored.date !== today) return { date: today, count: 0 };
  return stored;
}

function incrementUsage() {
  const usage = getUsage();
  usage.count += 1;
  localStorage.setItem('ptt_usage', JSON.stringify(usage));
  updateUsageBadge();
}

function getRemainingTests() {
  return Math.max(0, DAILY_LIMIT - getUsage().count);
}

function updateUsageBadge() {
  const el = document.getElementById('usageCount');
  if (el) el.textContent = getRemainingTests();
}

// ===== SCREENS =====
function goTo(screenId) {
  const current = document.querySelector('.screen.active');
  const next = document.getElementById(screenId);
  if (!next || current === next) return;
  current.classList.add('exit');
  setTimeout(() => current.classList.remove('active', 'exit'), 300);
  next.classList.add('active');
  next.scrollTop = 0;
}

// ===== FILES =====
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

// ===== PILLS =====
document.querySelectorAll('.option-pills').forEach(group => {
  group.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
  });
});

// ===== CHAR COUNT =====
document.getElementById('contentText').addEventListener('input', function () {
  document.getElementById('charCount').textContent = this.value.length + ' caracteres';
});

// ===== TIMER TOGGLE =====
function toggleTimer() {
  const enabled = document.getElementById('timerToggle').checked;
  state.timerEnabled = enabled;
  const opts = document.getElementById('timerOptions');
  if (enabled) opts.classList.remove('hidden');
  else opts.classList.add('hidden');
}

// ===== GENERATE =====
async function generateTest() {
  if (getRemainingTests() <= 0) {
    showToast('Limite diario alcanzado. Vuelve manana.', 'error');
    return;
  }

  const text = document.getElementById('contentText').value.trim();
  if (!text && state.files.length === 0) {
    showToast('Agrega texto o sube un archivo primero.', 'error');
    return;
  }

  const numQuestions = document.querySelector('#numQuestions .pill.active')?.dataset.value || '10';
  const difficulty = document.querySelector('#difficulty .pill.active')?.dataset.value || 'medio';
  state.timerMinutes = parseInt(document.querySelector('#timerMinutes .pill.active')?.dataset.value || '10');

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
      body: JSON.stringify({ content: contentParts, numQuestions, difficulty })
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Error desconocido');

    incrementUsage();
    state.testData = data;
    state.answers = new Array(data.questions.length).fill(null);
    state.currentQuestion = 0;

    await delay(500);
    renderStudyGuide();
    goTo('screen-study');

  } catch (err) {
    await delay(300);
    goTo('screen-input');
    showToast(err.message || 'Error al generar el test.', 'error');
  }
}

// ===== STUDY GUIDE =====
function renderStudyGuide() {
  const { topic, keyPoints } = state.testData;
  document.getElementById('studyTopic').textContent = topic;

  const kpList = document.getElementById('keyPoints');
  if (keyPoints && keyPoints.length > 0) {
    kpList.innerHTML = keyPoints.map(p => `<li>${p}</li>`).join('');
  } else {
    kpList.innerHTML = '<li>Revisa el material antes de empezar el test.</li>';
  }
}

function startTest() {
  renderTest();
  goTo('screen-test');
  if (state.timerEnabled) startTimer();
}

// ===== TIMER =====
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

// ===== LOADING STEPS =====
function animateLoadingSteps() {
  const steps = ['step1', 'step2', 'step3', 'step4'];
  const subtitles = ['Analizando el contenido...', 'Extrayendo conceptos clave...', 'Creando preguntas...', 'Casi listo!'];
  steps.forEach(id => document.getElementById(id).classList.remove('active', 'done'));
  document.getElementById(steps[0]).classList.add('active');
  steps.forEach((id, i) => {
    setTimeout(() => {
      if (i > 0) { document.getElementById(steps[i-1]).classList.remove('active'); document.getElementById(steps[i-1]).classList.add('done'); }
      document.getElementById(id).classList.add('active');
      document.getElementById('loadingSubtitle').textContent = subtitles[i];
    }, i * 1800);
  });
}

// ===== RENDER TEST =====
function renderTest() {
  document.getElementById('topicBadge').textContent = state.testData.topic;
  renderQuestion();
}

function renderQuestion() {
  const { questions } = state.testData;
  const q = questions[state.currentQuestion];
  const total = questions.length;
  const current = state.currentQuestion + 1;

  document.getElementById('progressText').textContent = current + ' / ' + total;
  document.getElementById('progressFill').style.width = ((current / total) * 100) + '%';
  document.getElementById('questionNumber').textContent = 'Pregunta ' + current;
  document.getElementById('questionText').textContent = q.question;

  const letters = ['A', 'B', 'C', 'D'];
  const saved = state.answers[state.currentQuestion];
  const revealed = saved !== null;

  document.getElementById('optionsList').innerHTML = q.options.map((opt, i) => {
    let cls = '';
    if (revealed) { if (i === q.correct) cls = 'correct'; else if (i === saved) cls = 'wrong'; }
    else if (i === saved) cls = 'selected';
    return `<button class="option-btn ${cls}" onclick="selectOption(${i})" ${revealed ? 'disabled' : ''}><span class="option-letter">${letters[i]}</span><span>${opt}</span></button>`;
  }).join('');

  if (revealed) {
    const box = document.createElement('div');
    box.className = 'explanation-box';
    box.innerHTML = '<strong>Explicacion:</strong> ' + q.explanation;
    document.getElementById('optionsList').appendChild(box);
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

function selectOption(index) {
  if (state.answers[state.currentQuestion] !== null) return;
  state.answers[state.currentQuestion] = index;
  renderQuestion();
}

function nextQuestion() {
  if (state.currentQuestion === state.testData.questions.length - 1) { showResults(); return; }
  state.currentQuestion++;
  renderQuestion();
}

function prevQuestion() {
  if (state.currentQuestion === 0) return;
  state.currentQuestion--;
  renderQuestion();
}

// ===== RESULTS =====
function showResults() {
  stopTimer();
  const { questions } = state.testData;
  const score = state.answers.filter((a, i) => a === questions[i].correct).length;
  const total = questions.length;
  const pct = score / total;

  document.getElementById('scoreNumber').textContent = score;
  document.getElementById('scoreTotalLabel').textContent = total;

  let title, subtitle;
  if (pct >= 0.9) { title = 'Excelente'; subtitle = 'Dominas este tema a la perfeccion.'; }
  else if (pct >= 0.7) { title = 'Muy bien'; subtitle = 'Buen dominio. Repasa los fallos.'; }
  else if (pct >= 0.5) { title = 'Vas por buen camino'; subtitle = 'Sigue practicando, casi lo tienes.'; }
  else { title = 'A estudiar mas'; subtitle = 'Repasa el material y vuelve a intentarlo.'; }

  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSubtitle').textContent = subtitle;

  const circle = document.getElementById('scoreCircle');
  const circumference = 439.82;
  circle.style.strokeDashoffset = circumference;
  setTimeout(() => {
    circle.style.transition = 'stroke-dashoffset 1s ease';
    circle.style.strokeDashoffset = circumference * (1 - pct);
  }, 300);

  document.getElementById('answersReview').innerHTML = questions.map((q, i) => {
    const userAns = state.answers[i];
    const isCorrect = userAns === q.correct;
    return `<div class="review-item ${isCorrect ? 'correct-item' : 'wrong-item'}">
      <div class="review-header"><div class="review-icon ${isCorrect ? 'ok' : 'fail'}">${isCorrect ? '✓' : '✗'}</div><p class="review-q">${q.question}</p></div>
      <div class="review-answer">${!isCorrect ? '<span class="wrong-label">Tu respuesta: ' + (userAns !== null ? q.options[userAns] : 'Sin responder') + '</span><br />' : ''}<span class="correct-label">Correcta: ${q.options[q.correct]}</span></div>
      <p class="review-explanation">${q.explanation}</p>
    </div>`;
  }).join('');

  goTo('screen-results');
}

function retryTest() {
  stopTimer();
  state.answers = new Array(state.testData.questions.length).fill(null);
  state.currentQuestion = 0;
  const circle = document.getElementById('scoreCircle');
  circle.style.transition = 'none';
  circle.style.strokeDashoffset = 439.82;
  renderTest();
  goTo('screen-test');
  if (state.timerEnabled) startTimer();
}

function resetApp() {
  stopTimer();
  state.files = [];
  state.testData = null;
  state.answers = [];
  state.currentQuestion = 0;
  document.getElementById('contentText').value = '';
  document.getElementById('charCount').textContent = '0 caracteres';
  document.getElementById('filePreviews').innerHTML = '';
  document.getElementById('filePreviews').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  document.getElementById('timerToggle').checked = false;
  document.getElementById('timerOptions').classList.add('hidden');
  state.timerEnabled = false;
  const circle = document.getElementById('scoreCircle');
  circle.style.transition = 'none';
  circle.style.strokeDashoffset = 439.82;
  goTo('screen-landing');
}

// ===== UTILS =====
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
