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
  'github.com','githubusercontent.com','cloudflare.com',
  'yahoo.co.jp','yahoo.com','rakuten.co.jp','line.me','line.com',
  'ntt.com','docomo.ne.jp','softbank.jp','au.com','biglobe.ne.jp',
  'nikkeibp.co.jp','nikkei.com','nhk.or.jp','asahi.com','yomiuri.co.jp',
  'stripe.com','paypal.com','visa.com','mastercard.com',
  'netflix.com','spotify.com','slack.com','zoom.us','notion.so',
  'openai.com','anthropic.com','deepmind.com',
  'wikipedia.org','wikimedia.org','mozilla.org','firefox.com',
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

function getDomainRiskHints(url) {
  try {
    const { hostname } = new URL(url);
    const hints = [];
    const h = hostname.toLowerCase().replace(/^www\./, '');
    const brands = ['google','amazon','apple','microsoft','facebook','paypal','rakuten','yahoo','docomo','softbank','line','ntt'];
    for (const brand of brands) {
      if (h.includes(brand) && !isTrustedDomain(url)) {
        hints.push(`WARN: contains "${brand}" but is NOT the official domain — possible impersonation`);
        break;
      }
    }
    if (h.split('.').length >= 5) hints.push('WARN: unusually many subdomains');
    if (h.replace(/[a-z.-]/g, '').length > 5) hints.push('WARN: many numbers/symbols in hostname');
    return hints.length > 0 ? hints.join('\n') : 'No structural red flags.';
  } catch { return 'Could not parse URL.'; }
}

const getSystemPrompt = (displayLang, siteIsJp, isTrusted, domainHints) => {
  const outputJa = displayLang === 'ja';
  const analysisContext = siteIsJp
    ? 'This may be a Japanese service. Apply Japanese market knowledge.'
    : 'Apply global/English market knowledge.';

  const trustedNote = isTrusted
    ? (outputJa
        ? '\n★ このドメインは世界的に著名な正規サービスです → 必ず ✅ 安全 にしてください。'
        : '\n★ Globally recognized legitimate service → MUST rate ✅ SAFE.')
    : '';

  const hintsBlock = outputJa
    ? `[ドメイン構造チェック]\n${domainHints}`
    : `[Domain structure check]\n${domainHints}`;

  if (outputJa) {
    return `あなたはウェブセキュリティアナリストです。
${analysisContext}${trustedNote}

${hintsBlock}

## 判定基準

✅ 安全 — 以下のいずれか:
- 検索結果にサイトの説明・ページ・評判が存在し、普通のサービス・企業・ブログと確認できる
- 詐欺・フィッシング報告がない
- インデックスされていない・情報が少ない（＝危険の証拠がない）→ ✅ 安全

⚠️ 注意 — 以下が複数ある場合のみ:
- 有名ブランドのタイポスクワッティング（上記チェックでWARN）
- 検索結果に実際の詐欺報告がある
- ページが即座にログインや個人情報を要求

🚨 危険 — 以下の明確な証拠がある場合のみ:
- 上記チェックでWARN + 詐欺報告あり
- 複数の明確なフィッシング証拠

## 絶対ルール
- 情報が少ない・不明 → ✅ 安全（CAUTIONにしない）
- 証拠なしに CAUTION/DANGEROUS にしない
- [SITE INFO]に正常なページやサービス説明があれば → ✅ 安全

フォーマット(150語以内):
サービス名: [検索結果から特定したサービス名。不明なら「企業/個人サイト」]
目的: [何をするサイトか。検索結果から推測]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [理由]
アドバイス: [一言]
必ず日本語で回答してください。`;
  }

  return `You are a web security analyst.
${analysisContext}${trustedNote}

${hintsBlock}

## VERDICT CRITERIA

✅ SAFE — Use when:
- Search results show normal pages, service info, or reputation for this domain
- No scam/phishing reports found
- Little or no indexed info (absence of evidence is NOT evidence of danger) → ✅ SAFE

⚠️ CAUTION — ONLY when multiple concrete red flags:
- WARN in domain check above (brand impersonation)
- Actual scam reports in search results
- Page immediately demands login/personal info with no context

🚨 DANGEROUS — ONLY with clear evidence:
- WARN in domain check + scam reports present
- Multiple confirmed phishing indicators

## ABSOLUTE RULES
- Insufficient data / unknown → ✅ SAFE (never default to CAUTION)
- No evidence = no CAUTION/DANGEROUS
- If [SITE INFO] shows normal pages or service description → ✅ SAFE

FORMAT (≤150 words):
Identity: [service name from search results; "Business/personal site" if unclear]
Purpose: [what it does, inferred from search results]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [specific reason]
Advice: [one line]
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
  const domainHints = targetUrl ? getDomainRiskHints(targetUrl) : 'No URL.';

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
          { role: 'system', content: getSystemPrompt(lang, siteIsJp, trusted, domainHints) },
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
