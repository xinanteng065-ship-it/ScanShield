// api/analyze.js
// Vercel環境変数: OPENAI_API_KEY, SERPER_API_KEY, SAFE_BROWSING_API_KEY

const TRUSTED_DOMAINS = [
  'google.com','google.co.jp','googleapis.com','goo.gl','gemini.google.com',
  'apple.com','icloud.com',
  'microsoft.com','live.com','outlook.com','azure.com','bing.com',
  'facebook.com','instagram.com','whatsapp.com','meta.com',
  'amazon.com','amazon.co.jp','amazonaws.com','amzn.to',
  'twitter.com','x.com','t.co','youtube.com','youtu.be',
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
    const flags = [];
    const h = hostname.toLowerCase().replace(/^www\./, '');

    const brands = ['google','amazon','apple','microsoft','facebook','paypal',
                    'rakuten','yahoo','docomo','softbank','line','ntt','instagram'];
    for (const brand of brands) {
      if (h.includes(brand) && !isTrustedDomain(url)) {
        flags.push(`🚨 IMPERSONATION: hostname contains "${brand}" but is NOT the official domain`);
        break;
      }
    }
    if (h.split('.').length >= 5)
      flags.push('⚠️ Unusually many subdomains — common in phishing URLs');
    if (h.replace(/[a-z.-]/g, '').length > 5)
      flags.push('⚠️ Many numbers/symbols in hostname — suspicious pattern');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h))
      flags.push('🚨 Direct IP address — legitimate sites rarely use raw IPs');
    const freeHosts = ['ngrok.io','ngrok-free.app','vercel.app','netlify.app','github.io','glitch.me','replit.dev'];
    if (freeHosts.some(f => h.endsWith(f)))
      flags.push('⚠️ Free hosting subdomain — verify this is the intended service');

    return flags.length > 0 ? flags.join('\n') : '✅ No structural red flags detected.';
  } catch { return 'Could not parse URL.'; }
}

// ── Google Safe Browsing v4 API ────────────────────────────────────
async function checkSafeBrowsing(url) {
  const key = process.env.SAFE_BROWSING_API_KEY;
  if (!key) return null; // キーなし → スキップ（エラーにしない）

  try {
    const r = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'scan-shield', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: ['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE','POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    // matches が存在 → 脅威あり
    if (data.matches && data.matches.length > 0) {
      const types = [...new Set(data.matches.map(m => m.threatType))].join(', ');
      return `🚨 CONFIRMED THREAT (${types})`;
    }
    return '✅ Not listed in Google Safe Browsing';
  } catch { return null; }
}

// ── Serper 検索（analyze.js 内で直接実行） ────────────────────────
async function fetchSearchContext(url, lang) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  try {
    const { hostname } = new URL(url);
    const domain = hostname.replace(/^www\./, '');
    const isJa = lang === 'ja';
    const gl = isJa ? 'jp' : 'us';
    const hl = isJa ? 'ja' : 'en';

    const fetchSerper = async (q) => {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, gl, hl, num: 5 }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok ? r.json().catch(() => null) : null;
    };

    const q_site  = `site:${domain}`;
    const q_scam  = isJa ? `"${domain}" 詐欺 フィッシング` : `"${domain}" scam phishing fraud`;
    const q_about = isJa ? `${domain} サービス 概要` : `${domain} service about`;

    const [r1, r2, r3] = await Promise.allSettled([
      fetchSerper(q_site),
      fetchSerper(q_scam),
      fetchSerper(q_about),
    ]);

    const d1 = r1.status === 'fulfilled' ? r1.value : null;
    const d2 = r2.status === 'fulfilled' ? r2.value : null;
    const d3 = r3.status === 'fulfilled' ? r3.value : null;

    if (!d1 && !d2 && !d3) return null;

    let ctx = '[WEB SEARCH RESULTS]\n\n';

    // サイト概要
    ctx += '[SITE INFO]\n';
    let found = false;
    const ab = d1?.answerBox || d3?.answerBox;
    if (ab) {
      const t = ab.answer || ab.snippet || ab.title || '';
      if (t) { ctx += `Summary: ${t.slice(0, 300)}\n`; found = true; }
    }
    const kg = d1?.knowledgeGraph || d3?.knowledgeGraph;
    if (kg) {
      if (kg.title)       ctx += `Name: ${kg.title}\n`;
      if (kg.type)        ctx += `Type: ${kg.type}\n`;
      if (kg.description) ctx += `Description: ${kg.description.slice(0, 300)}\n`;
      found = true;
    }
    const sitePages = d1?.organic ?? [];
    if (sitePages.length > 0) {
      ctx += `[Pages on ${domain}]\n`;
      sitePages.slice(0, 3).forEach(x =>
        ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 120)}\n`
      );
      found = true;
    }
    if (!found) {
      const about = d3?.organic ?? [];
      if (about.length > 0) {
        ctx += `[Search results for "${domain}"]\n`;
        about.slice(0, 3).forEach(x =>
          ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 120)}\n`
        );
      } else {
        ctx += `(No indexed content found — may be new or very low-traffic)\n`;
      }
    }

    // 詐欺報告
    ctx += '\n[SCAM/THREAT REPORTS]\n';
    const scamHits = d2?.organic ?? [];
    if (scamHits.length > 0) {
      scamHits.slice(0, 4).forEach(x =>
        ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 150)}\n`
      );
    } else {
      ctx += '(No scam/phishing reports found — positive signal)\n';
    }

    return ctx;
  } catch { return null; }
}

// ── System prompt ─────────────────────────────────────────────────
const getSystemPrompt = (lang, siteIsJp, isTrusted, domainHints, safeBrowsing, searchCtx) => {
  const outputJa = lang === 'ja';
  const analysisContext = siteIsJp
    ? 'This may be a Japanese service. Apply Japanese market knowledge.'
    : 'Apply global/English market knowledge.';

  const trustedNote = isTrusted
    ? (outputJa
        ? '\n★ このドメインは世界的に著名な正規サービスです → ✅ 安全 にしてください。'
        : '\n★ This is a globally recognized legitimate service → Rate ✅ SAFE.')
    : '';

  const sbLine = safeBrowsing
    ? (outputJa ? `[GOOGLE SAFE BROWSING]\n${safeBrowsing}` : `[GOOGLE SAFE BROWSING]\n${safeBrowsing}`)
    : (outputJa ? '[GOOGLE SAFE BROWSING]\n(チェック不可 — 他の証拠で判断)' : '[GOOGLE SAFE BROWSING]\n(Unavailable — judge by other evidence)');

  const searchBlock = searchCtx ?? (outputJa
    ? '[WEB SEARCH RESULTS]\n(取得不可 — ドメイン構造とSafe Browsingで判断)'
    : '[WEB SEARCH RESULTS]\n(Unavailable — judge by domain structure and Safe Browsing)');

  const hintsBlock = outputJa
    ? `[ドメイン構造チェック]\n${domainHints}`
    : `[Domain structure analysis]\n${domainHints}`;

  if (outputJa) {
    return `あなたはウェブセキュリティアナリストです。証拠に基づき、公平かつ正確に判定してください。
${analysisContext}${trustedNote}

${sbLine}

${hintsBlock}

${searchBlock}

## 判定基準（厳守）

✅ 安全:
- 広く知られた正規サービス・企業・個人サイト・ブログ
- Googleにページがインデックスされており正常なコンテンツがある
- Safe Browsing ✅ かつ詐欺報告なし
- 情報が少ないだけで危険の証拠がない

⚠️ 注意:
- 有名サービスに似た名前だが公式ドメインではない（⚠️マーク）
- 詐欺・詐欺的という検索報告がある
- フリーホスティングで金融/ログイン要求
- 判断できないが怪しい点がある

🚨 危険:
- Safe Browsing が 🚨 CONFIRMED THREAT
- ドメインに🚨マーク（有名ブランド偽装 or IPアドレス） + 詐欺報告あり
- 検索結果に複数のフィッシング確認報告

## 優先ルール
1. Safe Browsing 🚨 → 即座に 🚨 危険
2. ドメイン🚨 + 詐欺報告あり → 🚨 危険
3. ドメイン⚠️ or 詐欺報告あり → ⚠️ 注意
4. Safe Browsing ✅ + 詐欺報告なし → ✅ 安全
5. 情報不足・証拠なし → ✅ 安全（証拠なしで🚨禁止）

フォーマット（150語以内）:
サービス名: [名称、または「企業/個人サイト」]
目的: [何をするサイトか1〜2文]
安全性: [✅ 安全 / ⚠️ 注意 / 🚨 危険] — [具体的な根拠]
アドバイス: [一言]
必ず日本語で回答してください。`;
  }

  return `You are a web security analyst. Assess accurately and fairly based on all provided evidence.
${analysisContext}${trustedNote}

${sbLine}

${hintsBlock}

${searchBlock}

## VERDICT CRITERIA (strict)

✅ SAFE:
- Well-known legitimate service, corporate/personal site, blog
- Google has indexed normal content for this domain
- Safe Browsing ✅ and no scam reports
- Insufficient info but no danger signals

⚠️ CAUTION:
- Resembles a known brand but NOT the official domain (⚠️ flag above)
- Search results mention scam/fraud reports
- Free hosting subdomain requesting login/payment
- Suspicious but not conclusive evidence

🚨 DANGEROUS:
- Safe Browsing shows 🚨 CONFIRMED THREAT
- Domain analysis 🚨 (impersonation/raw IP) + scam reports present
- Multiple confirmed phishing reports in search results

## PRIORITY RULES
1. Safe Browsing 🚨 → immediately 🚨 DANGEROUS
2. Domain 🚨 + scam reports → 🚨 DANGEROUS
3. Domain ⚠️ OR scam reports → ⚠️ CAUTION
4. Safe Browsing ✅ + no scam reports → ✅ SAFE
5. Insufficient info, no evidence → ✅ SAFE (never use 🚨 without evidence)

FORMAT (≤150 words):
Identity: [service name, or "Business/personal site"]
Purpose: [what it does, 1–2 sentences]
Safety: [✅ SAFE / ⚠️ CAUTION / 🚨 DANGEROUS] — [specific evidence-based reason]
Advice: [one action]
Always respond in English.`;
};

// ── Main handler ──────────────────────────────────────────────────
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
  const trusted     = targetUrl ? isTrustedDomain(targetUrl) : false;
  const siteIsJp    = targetUrl ? isJapaneseSite(targetUrl) : false;
  const domainHints = targetUrl ? getDomainRiskHints(targetUrl) : 'No URL provided.';

  // URLがある場合のみ Safe Browsing + 検索を並列実行
  let safeBrowsing = null;
  let searchCtx    = null;

  if (targetUrl && !trusted) {
    // 信頼済みドメインは Safe Browsing / 検索不要（コスト削減）
    [safeBrowsing, searchCtx] = await Promise.all([
      checkSafeBrowsing(targetUrl),
      fetchSearchContext(targetUrl, lang),
    ]);
  } else if (targetUrl && trusted) {
    safeBrowsing = '✅ Trusted domain — skipped (well-known legitimate service)';
    searchCtx    = null;
  }

  const systemPrompt = getSystemPrompt(
    lang, siteIsJp, trusted, domainHints, safeBrowsing, searchCtx
  );

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
          { role: 'system', content: systemPrompt },
          ...history.slice(-6),
          { role: 'user', content: message },
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!r.ok) return res.status(502).json({ error: 'OpenAI error: ' + r.status });
    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
