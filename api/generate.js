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
    const { content, numQuestions = 10, difficulty = 'medio' } = req.body;

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: 'No hay contenido para generar el test.' });
    }

    const diffMap = { facil: 'facil', medio: 'medio', dificil: 'dificil' };

    const parts = [...content, {
      type: 'text',
      text: 'Basandote en el contenido anterior, genera exactamente ' + numQuestions + ' preguntas de opcion multiple con dificultad ' + (diffMap[difficulty] || 'medio') + '.\n\nRESPONDE UNICAMENTE con este JSON exacto, sin texto adicional:\n{"topic":"nombre del tema detectado","questions":[{"id":1,"question":"texto de la pregunta","options":["A) opcion A","B) opcion B","C) opcion C","D) opcion D"],"correct":0,"explanation":"explicacion breve de por que esa es la correcta"}]}\n\nEl campo correct es el indice 0-3 de la opcion correcta.'
    }];

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
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
      r.write(body);
      r.end();
    });

    if (data.status !== 200) {
      const msg = (data.body && data.body.error && data.body.error.message) || ('Error ' + data.status);
      return res.status(500).json({ error: msg });
    }

    const rawText = data.body.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Formato invalido. Intentalo de nuevo.');

    const testData = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ success: true, ...testData });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Error al generar el test.' });
  }
};

