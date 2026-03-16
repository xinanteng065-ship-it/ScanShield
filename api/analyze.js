// api/analyze.js
// Vercel環境変数: OPENAI_API_KEY

// 著名・信頼できるドメインのリスト（部分一致）
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

// 日本向けサイトかどうかを判定するTLD・ドメインリスト
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
  } catch {
    return false;
  }
}

function isJapaneseSite(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return JP_PATTERNS.some(p => hostname.endsWith(p) || hostname === p.replace(/^\./, ''));
  } catch {
    return false;
  }
}

const getSystemPrompt = (displayLang, siteIsJp, isTrusted) => {
  const outputJa = displayLang === 'ja';

  // サイトの地域に応じた分析コンテキスト（表示言語とは独立）
  const analysisContext = siteIsJp
    ? 'This may be a Japanese service. Evaluate using Japanese market knowledge and context.'
    : 'Evaluate using global/English market context and knowledge.';

  const trustedHint = isTrusted
    ? (outputJa
        ? '\n重要: このURLは世界的に著名な正規サービスです。特別な理由がない限り ✅ 安全 と判定してください。'
        : '\nIMPORTANT: This URL is a globally recognized legitimate service. Rate ✅ SAFE unless there is a clear specific reason not to.')
    : '';

  if (outputJa) {
    return `あなたは公平なウェブセキュリティアナリストです。
${analysisContext}
ルール: ✅ 安全=有名なブランド/正当なサービス。 ⚠️ 注意=不審なシグナルが複数ある。 🚨 危険=明らかな詐欺/フィッシング。
重要: 迷ったら必ず ✅ 安全 にしてください。既知の大企業・有名サービスは ✅ 安全 と判定してください。${trustedHint}
フォーマット (150語以内):
サービス名: [何のサービスか]
目的: [何をするサイトか]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [理由]
アドバイス: [具体的なアドバイス1つ]
必ず日本語で回答してください。`;
  }

  return `You are a balanced web security analyst.
${analysisContext}
RULES: ✅ SAFE=known brand/legit service. ⚠️ CAUTION=multiple suspicious signals. 🚨 DANGEROUS=clear scam/phishing.
CRITICAL: When in doubt → ✅ SAFE. Known major brands always rate ✅ SAFE.${trustedHint}
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

  // URLを抽出して判定
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
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(22000),
    });

    if (!r.ok) {
      return res.status(502).json({ error: 'OpenAI error: ' + r.status });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
