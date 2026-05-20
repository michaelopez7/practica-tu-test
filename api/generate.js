const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada en el servidor.' });

  try {
    const { content, numQuestions = 10, difficulty = 'medio' } = req.body;

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: 'No hay contenido para generar el test.' });
    }

    const difficultyMap = { facil: 'facil', medio: 'medio', dificil: 'dificil' };

    const parts = content.map(part => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'image') return { inline_data: { mime_type: part.source.media_type, data: part.source.data } };
      return null;
    }).filter(Boolean);

    parts.push({
      text: 'Basandote en el contenido anterior, genera exactamente ' + numQuestions + ' preguntas de opcion multiple con dificultad ' + (difficultyMap[difficulty] || 'medio') + '.\n\nRESPONDE UNICAMENTE con este JSON exacto, sin texto adicional ni bloques de codigo:\n{"topic":"nombre del tema detectado","questions":[{"id":1,"question":"texto de la pregunta","options":["A) opcion A","B) opcion B","C) opcion C","D) opcion D"],"correct":0,"explanation":"explicacion breve de por que esa es la correcta"}]}\n\nEl campo correct es el indice 0-3 de la opcion correcta en el array options.'
    });

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
    });

    const data = await new Promise((resolve, reject) => {
      const path = '/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };

      const reqHttp = https.request(options, (resp) => {
        let raw = '';
        resp.on('data', chunk => raw += chunk);
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
          catch (e) { reject(new Error('Respuesta invalida de la API')); }
        });
      });

      reqHttp.on('error', reject);
      reqHttp.write(body);
      reqHttp.end();
    });

    if (data.status !== 200) {
      const msg = (data.body && data.body.error && data.body.error.message) || ('Error de API: ' + data.status);
      return res.status(500).json({ error: msg });
    }

    const rawText = data.body.candidates[0].content.parts[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('La IA no devolvio un formato valido. Intentalo de nuevo.');

    const testData = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ success: true, ...testData });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Error al generar el test.' });
  }
};
