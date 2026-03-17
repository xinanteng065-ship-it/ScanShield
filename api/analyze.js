// api/analyze.js
// Vercel環境変数: OPENAI_API_KEY

const TRUSTED_DOMAINS = [
  'google.com','google.co.jp','googleapis.com','goo.gl','gemini.google.com',
  'apple.com','icloud.com',
  'microsoft.com','live.com','outlook.com','azure.com','bing.com',
  'facebook.com','instagram.com','whatsapp.com','meta.com',
  'amazon.com','amazon.co.jp','amazonaws.com','amzn.to',
  'twitter.com','x.com','t.co',
  'youtube.com','youtu.be',
  'github.com','githubusercontent.com',
  'cloudflare.com',
  'yahoo.co.jp','yahoo.com','rakuten.co.jp','line.me','line.com',
  'ntt.com','docomo.ne.jp','softbank.jp','au.com','biglobe.ne.jp',
  'nikkeibp.co.jp','nikkei.com','nhk.or.jp','asahi.com','yomiuri.co.jp',
  'stripe.com','paypal.com','visa.com','mastercard.com',
  'netflix.com','spotify.com','slack.com','zoom.us','notion.so',
  'openai.com','anthropic.com','deepmind.com',
  'wikipedia.org','wikimedia.org',
  'mozilla.org','firefox.com',
];

const JP_PATTERNS = [
  '.co.jp','.ne.jp','.or.jp','.ac.jp','.go.jp','.ed.jp','.gr.jp','.jp',
  'rakuten.co.jp','docomo.ne.jp','softbank.jp','nhk.or.jp',
  'asahi.com','yomiuri.co.jp','nikkei.com','biglobe.ne.jp','ntt.com',
  'ameba.jp','fc2.com','hatena.ne.jp','cookpad.com',
  'mercari.com','paypay.ne.jp','jreast.co.jp','jal.co.jp','ana.co.jp',
  'yahoo.co.jp','line.me','line.com',
];

function isTrustedDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return TRUSTED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

function isJapaneseSite(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return JP_PATTERNS.some(p => hostname.endsWith(p) || hostname === p.replace(/^\./, ''));
  } catch { return false; }
}

const getSystemPrompt = (displayLang, siteIsJp, isTrusted) => {
  const outputJa = displayLang === 'ja';
  const analysisContext = siteIsJp
    ? 'This may be a Japanese service. Use Japanese market knowledge to evaluate.'
    : 'Use global/English market knowledge to evaluate.';

  const trustedHint = isTrusted
    ? (outputJa
        ? '\n特記: このドメインは世界的に著名な正規サービスです。'
        : '\nNOTE: This domain is a globally recognized legitimate service.')
    : '';

  if (outputJa) {
    return `あなたは慎重なウェブセキュリティアドバイザーです。
${analysisContext}

重要: あなたの判定はあくまで「参考情報」です。断定はせず、ユーザーが自分で判断できるよう情報を提供してください。

判定の目安（確信度に応じて使い分けてください）:
✅ 安全 — 広く知られた正規サービスであることが確認できる
⚠️ 注意 — 不審な点があり、慎重に確認することを推奨
🚨 危険 — フィッシングや詐欺の強い兆候が複数確認できる（断定ではなく警告として）

注意事項:
- 不明・情報不足の場合は ⚠️ 注意 にしてください（危険と断定しない）
- 検索結果に詐欺報告がある場合は必ず言及してください
- 有名サービスを模倣した明らかな偽ドメインのみ 🚨 危険 にしてください${trustedHint}

フォーマット (150語以内):
サービス名: [何のサービスか、不明な場合は「不明」]
目的: [何をするサイトか]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [理由。断定ではなく「〜の可能性があります」などの表現を使う]
アドバイス: [ユーザーが自分で確認できる具体的な行動1つ]
必ず日本語で回答してください。`;
  }

  return `You are a cautious web security advisor.
${analysisContext}

IMPORTANT: Your assessment is for reference only. Do not make definitive claims — help users make their own informed decisions.

VERDICT GUIDELINES (use based on confidence level):
✅ SAFE — Confirmed well-known legitimate service with strong evidence
⚠️ CAUTION — Suspicious signals present; recommend careful verification before proceeding
🚨 DANGEROUS — Multiple strong indicators of phishing/scam (treat as a warning, not a verdict)

RULES:
- When uncertain or lacking data → use ⚠️ CAUTION (never over-assert danger)
- Only use 🚨 DANGEROUS for clear impersonation of known brands or confirmed scam reports
- Always mention if search results contain scam/phishing reports
- Phrase findings as possibilities, not certainties ("appears to", "may be", "signs suggest")${trustedHint}

FORMAT (≤150 words):
Identity: [what service, or "Unknown" if unclear]
Purpose: [what it does]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [reason, using hedged language]
Advice: [one specific action the user can take to verify themselves]
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

  const urlMatch = message.match(/https?:\/\/[^\s\n]+/);
  const targetUrl = urlMatch ? urlMatch[0] : null;
  const trusted = targetUrl ? isTrustedDomain(targetUrl) : false;
  const siteIsJp = targetUrl ? isJapaneseSite(targetUrl) : false;

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
          { role: 'system', content: getSystemPrompt(lang, siteIsJp, trusted) },
          ...history.slice(-8),
          { role: 'user', content: message },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(22000),
    });

    if (!r.ok) return res.status(502).json({ error: 'OpenAI error: ' + r.status });
    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
