const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada en el servidor.' });

  try {
    const {
      content, numQuestions = 10, difficulty = 'medio',
      language = 'Auto', examType = 'academico',
      questionTypes = ['multiple_choice'], notes = ''
    } = req.body;

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: 'No hay contenido para generar el test.' });
    }

    const diffDesc = {
      facil: 'BASICA: solo definiciones, hechos directos y conceptos fundamentales. Preguntas que alguien puede responder con una lectura superficial.',
      medio: 'INTERMEDIA: aplicacion de conceptos, analisis simple, comparaciones entre ideas. El estudiante debe entender el material, no solo memorizarlo.',
      dificil: 'AVANZADA Y EXIGENTE: analisis profundo, sintesis de conceptos, evaluacion critica, casos complejos y aplicacion real. PROHIBIDO incluir preguntas de definicion basica o simple memorizacion. Cada pregunta debe requerir razonamiento real.'
    };

    const langInstr = language === 'Auto'
      ? 'Detecta el idioma principal del contenido y usa ESE MISMO idioma para absolutamente todo: preguntas, opciones, explicaciones. Si el contenido es en ingles, todo en ingles. Si es en espanol, todo en espanol.'
      : `Usa EXCLUSIVAMENTE ${language} para todas las preguntas, opciones y explicaciones. Esto es obligatorio sin excepcion.`;

    const typeDescriptions = {
      multiple_choice: 'multiple_choice: 4 opciones (A, B, C, D), exactamente una correcta. Campo "correct" = indice 0-3.',
      true_false: 'true_false: afirmacion verdadera o falsa. Campo "correct" = true o false (booleano).',
      fill_blank: 'fill_blank: la pregunta tiene ___ donde va la respuesta. Campo "answer" = respuesta exacta (una palabra o frase corta).',
      ordering: 'ordering: elementos a ordenar. Campo "items" contiene los elementos EN ORDEN CORRECTO (el sistema los barajara). Minimo 3, maximo 5 items.',
      essay: 'essay: respuesta abierta. "modelAnswer" = respuesta modelo completa. "keyPoints" = array de 2-3 conceptos clave que debe mencionar el estudiante.',
      math: 'math: problema matematico/cientifico. "answer" = resultado exacto (numero o expresion). "steps" = solucion paso a paso.'
    };

    const enabledTypes = (questionTypes || ['multiple_choice']).filter(t => typeDescriptions[t]);
    const typesText = enabledTypes.map(t => '- ' + typeDescriptions[t]).join('\n');

    const examTypeDesc = {
      academico: 'examen universitario o academico',
      certificacion: 'examen de certificacion profesional',
      idiomas: 'examen de idiomas (vocabulario, gramatica, comprension)',
      matematicas: 'examen de matematicas o ciencias exactas',
      oposiciones: 'examen de oposicion o concurso publico'
    }[examType] || 'evaluacion general';

    const examplesByType = {
      multiple_choice: '{"id":1,"type":"multiple_choice","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"La opcion A es correcta porque [razon especifica]. B es incorrecta porque [razon]. C es incorrecta porque [razon]. D es incorrecta porque [razon]."}',
      true_false: '{"id":2,"type":"true_false","question":"Afirmacion concreta...","correct":true,"explanation":"Es verdadera/falsa porque [razon detallada con fundamento]."}',
      fill_blank: '{"id":3,"type":"fill_blank","question":"El proceso de ___ consiste en transformar...","answer":"fotosintesis","explanation":"La respuesta correcta es [termino] porque [razon con contexto]."}',
      ordering: '{"id":4,"type":"ordering","question":"Ordena los siguientes pasos del proceso de mitosis:","items":["Profase: condensacion de cromosomas","Metafase: alineacion en el ecuador","Anafase: separacion de cromatidas","Telofase: formacion de nucleos hijos"],"explanation":"Este orden es correcto porque [razon biologica/logica del proceso]."}',
      essay: '{"id":5,"type":"essay","question":"Explica con tus palabras que es y para que sirve la homeostasis.","modelAnswer":"La homeostasis es el proceso mediante el cual los organismos mantienen condiciones internas estables (temperatura, pH, glucosa) a pesar de cambios externos. Es fundamental para la supervivencia celular porque las enzimas y reacciones bioquimicas requieren condiciones especificas.","keyPoints":["equilibrio interno","condiciones estables","mecanismos de regulacion"],"explanation":"La homeostasis es un concepto central en biologia porque [razon]."}',
      math: '{"id":6,"type":"math","question":"Un tren viaja a 120 km/h. ¿Cuanto tiempo tardara en recorrer 300 km?","answer":"2.5 horas","steps":"Paso 1: Usar la formula t = d/v. Paso 2: t = 300 km / 120 km/h. Resultado: t = 2.5 horas","explanation":"Se aplica la formula de cinematica basica tiempo = distancia / velocidad porque [razon]."}'
    };

    const examples = enabledTypes.map(t => examplesByType[t]).filter(Boolean).join(',\n    ');

    const promptText = `Eres un profesor universitario experto creando un ${examTypeDesc}.

IDIOMA OBLIGATORIO: ${langInstr}

DIFICULTAD: ${diffDesc[difficulty] || diffDesc.medio}

TIPOS DE PREGUNTAS PERMITIDOS (usa SOLO estos, variandolos segun lo que el contenido requiera naturalmente):
${typesText}
${notes ? `\nENFOQUE ESPECIFICO DEL USUARIO (prioridad alta): ${notes}` : ''}

REGLAS CRITICAS - INCUMPLIRLAS INVALIDA EL TEST:
1. Basa CADA pregunta y respuesta en conocimiento academico verificable y preciso. No inventes datos, fechas, nombres o estadisticas.
2. Para multiple_choice: la explicacion SIEMPRE debe indicar por que la respuesta correcta es correcta Y por que CADA opcion incorrecta es incorrecta.
3. Distribuye inteligentemente: si hay pasos/procesos usa ordering, si hay calculos usa math, si necesita explicar usa essay. No fuerces tipos que no aplican.
4. Dificultad REAL: nivel dificil debe requerir razonamiento, analisis o sintesis. Nunca memorizacion simple.
5. Genera exactamente ${numQuestions} preguntas.
6. El campo "topic" debe ser el nombre especifico del tema, no generico.

RESPONDE UNICAMENTE con este JSON exacto, sin ningun texto antes ni despues:
{
  "topic": "nombre especifico del tema en el idioma del contenido",
  "questions": [
    ${examples}
  ]
}`;

    const parts = [...content, { type: 'text', text: promptText }];

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: parts }]
    });

    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const r = https.request(options, (resp) => {
        let raw = '';
        resp.on('data', chunk => raw += chunk);
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
          catch (e) { reject(new Error('Respuesta invalida de la API')); }
        });
      });
      r.on('error', reject);
      r.write(body


