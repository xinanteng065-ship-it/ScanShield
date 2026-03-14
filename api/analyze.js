// api/analyze.js
// Vercel環境変数: OPENAI_API_KEY

const getSystemPrompt = (lang) => {
  const isJa = lang === 'ja';
  
  if (isJa) {
    return `あなたは公平なウェブセキュリティアナリストです。
ルール: ✅ 安全=有名なブランド/正当。 ⚠️ 注意=不審なシグナル。 🚨 危険=明らかな詐欺。 迷ったら → ✅ 安全。
フォーマット (150語以内):
サービス名: [何のサービスか]
目的: [何をするサイトか]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [理由]
アドバイス: [具体的なアドバイス1つ]
必ず日本語で回答してください。`;
  }

  return `You are a balanced web security analyst. Give FAIR assessments.
RULES: ✅ SAFE=known brand/legit. ⚠️ CAUTION=suspicious signals. 🚨 DANGEROUS=clear scam. When in doubt → SAFE.
FORMAT (≤150 words):
Identity: [what service]
Purpose: [what it does]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [reason]
Advice: [one action]
Always respond in English.`;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // フロントエンドから lang を受け取るように変更
  const { message, history = [], lang = 'en' } = req.body ?? {};
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
          { role: 'system', content: getSystemPrompt(lang) },
          ...history.slice(-8),
          { role: 'user', content: message },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(22000),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: 'OpenAI error: ' + r.status });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
