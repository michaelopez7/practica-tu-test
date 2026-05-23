const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada.' });

  try {
    const { question, modelAnswer, keyPoints, userAnswer } = req.body;

    if (!userAnswer || !userAnswer.trim()) {
      return res.status(200).json({ success: true, correct: false, score: 0, feedback: 'No escribiste ninguna respuesta.' });
    }

    const promptText = `Evalua la respuesta de un estudiante. Responde en el MISMO idioma que la pregunta.

PREGUNTA: ${question}
RESPUESTA MODELO: ${modelAnswer}
PUNTOS CLAVE ESPERADOS: ${(keyPoints || []).join(' | ')}
RESPUESTA DEL ESTUDIANTE: ${userAnswer}

Evalua si la respuesta captura los conceptos esenciales. Se justo pero exigente.

RESPONDE UNICAMENTE con este JSON:
{"correct":true,"score":0.0,"feedback":"1-2 oraciones: que hizo bien y que le falta. Si es incorrecta, explica el concepto correcto brevemente."}`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: promptText }]
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
          catch (e) { reject(new Error('Respuesta invalida')); }
        });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    if (data.status !== 200) return res.status(500).json({ error: 'Error al evaluar respuesta' });

    const rawText = data.body.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Formato invalido');

    return res.status(200).json({ success: true, ...JSON.parse(jsonMatch[0]) });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
