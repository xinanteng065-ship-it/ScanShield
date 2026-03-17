// api/search.js
// Vercel環境変数: SERPER_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // フロントエンドからlangが来ても、検索自体は英語で固定するため無視気味に扱います
  const { url, domain, serviceName } = req.body ?? {};
  if (!domain && !url) return res.status(200).json({ result: null });

  const target = serviceName || domain;

  // ⭐️ 常に英語で、グローバルの脅威情報と公式サイトを狙う
  const queryRisk = `"${target}" scam OR phishing OR fraud`;
  const queryRep  = `"${target}" official website OR legitimate`;

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRisk, gl: 'us', hl: 'en', num: 4 }), // 米国・英語固定
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),

      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRep, gl: 'us', hl: 'en', num: 4 }), // 米国・英語固定
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),
    ]);

    let ctx = '[SEARCH]\n';
    [[r1, 'Risk'], [r2, 'Official']].forEach(([r, label]) => {
      if (!r?.organic) return;
      ctx += `[${label}]\n`;
      r.organic.slice(0, 3).forEach(x => {
        ctx += `• ${x.title ?? ''}\n  URL: ${x.link ?? ''}\n  Snippet: ${(x.snippet ?? '').slice(0, 120)}\n`;
      });
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    console.error('search error:', e);
    return res.status(200).json({ result: null });
  }
}
