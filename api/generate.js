const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada en el servidor.' });

  try {
    const { content, numQuestions = 10, difficulty = 'medio' } = req.body;

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: 'No hay contenido para generar el test.' });
    }

    const difficultyMap = { facil: 'fácil', medio: 'medio', dificil: 'difícil' };

    const messageParts = [
      ...content,
      {
        type: 'text',
        text: `Basándote en el contenido anterior, genera exactamente ${numQuestions} preguntas de opción múltiple con dificultad ${difficultyMap[difficulty] || 'medio'}.

RESPONDE ÚNICAMENTE con este JSON exacto, sin texto adicional:
{
  "topic": "nombre del tema detectado",
  "questions": [
    {
      "id": 1,
      "question": "texto de la pregunta",
      "options": ["A) opción A", "B) opción B", "C) opción C", "D) opción D"],
      "correct": 0,
      "explanation": "explicación breve de por qué esa es la correcta"
    }
  ]
}

El campo "correct" es el índice 0-3 de la opción correcta en el array options.`
      }
    ];

    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: messageParts }]
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

      const reqHttp = https.request(options, (resp) => {
        let raw = '';
        resp.on('data', chunk => raw += chunk);
        resp.on('end', () => {
          try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
          catch (e) { reject(new Error('Respuesta inválida de la API')); }
        });
      });

      reqHttp.on('error', reject);
      reqHttp.write(body);
      reqHttp.end();
    });

    if (data.status !== 200) {
      const msg = data.body?.error?.message || `Error de API: ${data.status}`;
      return res.status(500).json({ error: msg });
    }

    const rawText = data.body.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('La IA no devolvió un formato válido. Inténtalo de nuevo.');

    const testData = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ success: true, ...testData });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Error al generar el test.' });
  }
};
