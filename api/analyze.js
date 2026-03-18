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

// ドメインの「怪しさ」を構造的にチェック
function getDomainRiskHints(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const hints = [];

    // 既知ブランド名のタイポスクワッティング検出
    const impersonationTargets = [
      'google','amazon','apple','microsoft','facebook','paypal',
      'rakuten','yahoo','docomo','softbank','line','ntt',
    ];
    const h = hostname.toLowerCase().replace(/^www\./, '');
    for (const brand of impersonationTargets) {
      // ブランド名を含むが公式TLDではないドメイン
      if (h.includes(brand) && !isTrustedDomain(url)) {
        hints.push(`WARN: hostname contains "${brand}" but is NOT the official domain`);
        break;
      }
    }

    // 過剰なサブドメイン
    const parts = h.split('.');
    if (parts.length >= 5) hints.push('WARN: unusually many subdomains');

    // 数字や記号が多い
    const randomLooking = h.replace(/[a-z.]/g, '').length > 6;
    if (randomLooking) hints.push('WARN: hostname contains many numbers/symbols');

    return hints.length > 0 ? hints.join('\n') : 'No structural red flags detected.';
  } catch {
    return 'Could not parse URL structure.';
  }
}

const getSystemPrompt = (displayLang, siteIsJp, isTrusted, domainHints) => {
  const outputJa = displayLang === 'ja';
  const analysisContext = siteIsJp
    ? 'This may be a Japanese service. Apply Japanese market knowledge.'
    : 'Apply global/English market knowledge.';

  const trustedNote = isTrusted
    ? (outputJa
        ? '\n★ このドメインは世界的に著名な正規サービスです → 必ず ✅ 安全 にしてください。'
        : '\n★ This domain is a globally recognized legitimate service → MUST rate ✅ SAFE.')
    : '';

  const hintsNote = outputJa
    ? `\n[ドメイン構造チェック結果]\n${domainHints}`
    : `\n[Domain structure analysis]\n${domainHints}`;

  if (outputJa) {
    return `あなたはウェブセキュリティアナリストです。
${analysisContext}${trustedNote}${hintsNote}

## 判定基準（重要）

✅ 安全 → 以下のいずれかに該当する場合:
- 広く知られた正規企業・サービスのドメイン
- ページ内容が普通のビジネス・ブログ・情報サイトで、詐欺の証拠がない
- 検索結果に詐欺・フィッシング報告が一切ない
- **情報が少ない・判断が難しい場合も ✅ 安全 にしてください**

⚠️ 注意 → 以下のような「具体的な不審点」が複数ある場合のみ:
- 既知ブランドのタイポスクワッティング（amaz0n.com など）
- 検索結果に詐欺報告が実際にある
- URL構造が極端に不自然（ランダム文字列・過剰なサブドメイン）
- ページが即座にログインや個人情報を要求している

🚨 危険 → 以下の明確な証拠がある場合のみ:
- 公式サービスを模倣した偽ドメイン（上記チェック結果に WARN がある）
- 検索結果に複数の詐欺・フィッシング報告がある
- マルウェア配布の証拠がある

## 絶対ルール
- 「情報が少ない」「判断できない」= ✅ 安全（CAUTIONにしない）
- 証拠なく CAUTION/DANGEROUS にしてはいけない
- 普通の企業サイト・ブログ・情報サイトは ✅ 安全

フォーマット (150語以内):
サービス名: [サービス名または「企業/個人サイト」]
目的: [何をするサイトか]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [具体的な理由]
アドバイス: [ユーザーへの一言]
必ず日本語で回答してください。`;
  }

  return `You are a web security analyst.
${analysisContext}${trustedNote}${hintsNote}

## VERDICT CRITERIA (critical)

✅ SAFE → Use when:
- Well-known legitimate company or service domain
- Page content is a normal business, blog, or information site with no signs of fraud
- No scam/phishing reports in search results
- **Insufficient data or unclear → DEFAULT to ✅ SAFE**

⚠️ CAUTION → Use ONLY when there are MULTIPLE concrete red flags:
- Typosquatting of a known brand (e.g. amaz0n.com)
- Actual scam reports found in search results
- Extremely suspicious URL structure (random strings, excessive subdomains)
- Page immediately demands login or personal information with no context

🚨 DANGEROUS → Use ONLY with CLEAR evidence:
- Confirmed impersonation of a known brand (WARN in domain analysis above)
- Multiple scam/phishing reports in search results
- Evidence of malware distribution

## ABSOLUTE RULES
- "Insufficient data" or "can't tell" = ✅ SAFE (NOT caution)
- Never use CAUTION/DANGEROUS without specific evidence
- Normal business sites, blogs, and info sites → ✅ SAFE

FORMAT (≤150 words):
Identity: [service name or "Business/personal site"]
Purpose: [what it does]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [specific reason]
Advice: [one line for the user]
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
  const domainHints = targetUrl ? getDomainRiskHints(targetUrl) : 'No URL provided.';

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
