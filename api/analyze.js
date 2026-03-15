// api/analyze.js
// Vercel環境変数: OPENAI_API_KEY

// 著名・信頼できるドメインのリスト（部分一致）
const TRUSTED_DOMAINS = [
  // Google
  'google.com','google.co.jp','googleapis.com','goo.gl','gemini.google.com',
  // Apple
  'apple.com','icloud.com',
  // Microsoft
  'microsoft.com','live.com','outlook.com','azure.com','bing.com',
  // Meta / Facebook
  'facebook.com','instagram.com','whatsapp.com','meta.com',
  // Amazon
  'amazon.com','amazon.co.jp','amazonaws.com','amzn.to',
  // Twitter / X
  'twitter.com','x.com','t.co',
  // YouTube
  'youtube.com','youtu.be',
  // GitHub
  'github.com','githubusercontent.com',
  // Cloudflare
  'cloudflare.com',
  // Popular JP services
  'yahoo.co.jp','yahoo.com','rakuten.co.jp','line.me','line.com',
  'ntt.com','docomo.ne.jp','softbank.jp','au.com','biglobe.ne.jp',
  'nikkeibp.co.jp','nikkei.com','nhk.or.jp','asahi.com','yomiuri.co.jp',
  // Payment
  'stripe.com','paypal.com','visa.com','mastercard.com',
  // Other major tech
  'netflix.com','spotify.com','slack.com','zoom.us','notion.so',
  'openai.com','anthropic.com','deepmind.com',
  'wikipedia.org','wikimedia.org',
  'mozilla.org','firefox.com',
];

function isTrustedDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return TRUSTED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

const getSystemPrompt = (lang, isTrusted) => {
  const isJa = lang === 'ja';

  const trustedHint = isTrusted
    ? (isJa
      ? '\n重要: このURLは世界的に著名な正規サービスのドメインです。特別な理由がない限り ✅ 安全 と判定してください。'
      : '\nIMPORTANT: This URL belongs to a globally recognized, legitimate service. Rate as ✅ SAFE unless there is a clear and specific reason not to.')
    : '';

  if (isJa) {
    return `あなたは公平なウェブセキュリティアナリストです。
ルール: ✅ 安全=有名なブランド/正当なサービス。 ⚠️ 注意=不審なシグナルが複数ある。 🚨 危険=明らかな詐欺/フィッシング。
重要: 迷ったら必ず ✅ 安全 にしてください。既知の大企業・有名サービスは積極的に ✅ 安全 と判定してください。${trustedHint}
フォーマット (150語以内):
サービス名: [何のサービスか]
目的: [何をするサイトか]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [理由]
アドバイス: [具体的なアドバイス1つ]
必ず日本語で回答してください。`;
  }

  return `You are a balanced web security analyst. Give FAIR assessments.
RULES: ✅ SAFE=known brand/legit service. ⚠️ CAUTION=multiple suspicious signals present. 🚨 DANGEROUS=clear scam/phishing.
CRITICAL: When in doubt → ✅ SAFE. Known major brands and services should ALWAYS be rated ✅ SAFE.${trustedHint}
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

  const { message, history = [], lang = 'en' } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'No message' });

  // URLを抽出して信頼済みドメインか判定
  const urlMatch = message.match(/https?:\/\/[^\s\n]+/);
  const trusted = urlMatch ? isTrustedDomain(urlMatch[0]) : false;

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
          { role: 'system', content: getSystemPrompt(lang, trusted) },
          ...history.slice(-8),
          { role: 'user', content: message },
        ],
        max_tokens: 600,
        temperature: 0.1, // 0.2→0.1 にして判定をより安定させる
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
