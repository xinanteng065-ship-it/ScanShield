// api/analyze.js
// OpenAI GPT-4o-mini をサーバー側で呼び出す
// APIキーはVercel環境変数 OPENAI_API_KEY に設定する

const SYS = `You are a balanced web security analyst. Give FAIR assessments.
RULES: ✅ SAFE=known brand/legit. ⚠️ CAUTION=suspicious signals. 🚨 DANGEROUS=clear scam. When in doubt → SAFE.
FORMAT (≤150 words):
Identity: [what service]
Purpose: [what it does]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [reason]
Advice: [one action]`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history = [] } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'No message' });

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYS },
          ...history.slice(-8),
          { role: 'user', content: message },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('OpenAI error:', err);
      return res.status(502).json({ error: 'OpenAI error' });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({ reply });

  } catch (e) {
    console.error('analyze error:', e);
    return res.status(500).json({ error: e.message });
  }
}