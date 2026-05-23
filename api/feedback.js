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
    const { topic, wrongQuestions, score, total } = req.body;
    if (!total) return res.status(400).json({ error: 'Sin preguntas' });

    const pct = Math.round((score / total) * 100);
    const wrongSummary = (wrongQuestions || []).slice(0, 8).map((q, i) =>
      `${i + 1}. "${q.question}" — Respondio: "${q.userAnswer}" — Correcto: "${q.correctAnswer}"`
    ).join('\n');

    const promptText = `Eres un tutor academico. Un estudiante acabo un test sobre "${topic}".

RESULTADO: ${score}/${total} (${pct}%)
${wrongSummary ? `\nFALLOS:\n${wrongSummary}` : '\nObtuvo puntaje perfecto.'}

Genera feedback constructivo y personalizado. Responde en el mismo idioma del tema "${topic}".

RESPONDE UNICAMENTE con este JSON:
{
  "summary": "Evaluacion directa del desempeno en 1-2 oraciones",
  "weakAreas": ["concepto especifico a repasar 1","concepto 2","concepto 3"],
  "recommendations": ["accion concreta de estudio 1","accion 2","accion 3"],
  "encouragement": "Mensaje motivacional de 1 oracion adaptado al resultado"
}

Si el puntaje es perfecto, weakAreas puede ser [] y recommendations deben ser para profundizar.`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
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

    if (data.status !== 200) return res.status(500).json({ error: 'Error generando feedback' });

    const rawText = data.body.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Formato invalido');

    return res.status(200).json({ success: true, ...JSON.parse(jsonMatch[0]) });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
