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

  // 信頼済みドメインのみ特別扱い。それ以外は証拠ベースで判定。
  const trustedHint = isTrusted
    ? (outputJa
        ? '\n特記: このドメインは世界的に著名な正規サービスです。ドメイン自体は ✅ 安全 ですが、URLパスに異常がある場合は注意してください。'
        : '\nNOTE: This domain is a globally recognized legitimate service. The domain itself is ✅ SAFE, but flag if the URL path looks abnormal.')
    : '';

  if (outputJa) {
    return `あなたは厳格なウェブセキュリティアナリストです。
${analysisContext}

判定基準:
✅ 安全 — 有名な正規サービス、または信頼できる証拠がある
⚠️ 注意 — 不審なシグナルがある（スペルミス、偽装、奇妙なURL構造など）
🚨 危険 — フィッシング/詐欺の明確な証拠がある（検索結果での報告、本物サービスの偽装など）

重要なルール:
- 検索結果に詐欺・フィッシング報告がある → 必ず ⚠️ 注意 以上にしてください
- 有名サービスを模倣した偽ドメインは → 🚨 危険 にしてください
- URLが本物のサービスと微妙に異なる（例: amazon-secure.com, paypa1.com）→ 🚨 危険${trustedHint}

フォーマット (150語以内):
サービス名: [何のサービスか]
目的: [何をするサイトか]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [理由を具体的に]
アドバイス: [具体的なアドバイス1つ]
必ず日本語で回答してください。`;
  }

  return `You are a strict web security analyst.
${analysisContext}

VERDICT CRITERIA:
✅ SAFE — Well-known legitimate service, or strong positive evidence
⚠️ CAUTION — Suspicious signals (typos, impersonation attempts, odd URL structure, unverifiable domain)
🚨 DANGEROUS — Clear evidence of phishing/scam (reported in search results, impersonating known brands, credential harvesting)

CRITICAL RULES:
- If search results report scam/phishing → rate ⚠️ CAUTION or higher, NOT SAFE
- If the URL impersonates a known brand with a fake domain → 🚨 DANGEROUS
- Subtle domain variations (amazon-secure.com, paypa1.com) → 🚨 DANGEROUS
- Unknown domain with no reputation data → ⚠️ CAUTION by default${trustedHint}

FORMAT (≤150 words):
Identity: [what service]
Purpose: [what it does]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [specific reason]
Advice: [one concrete action]
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
        temperature: 0.1,
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
