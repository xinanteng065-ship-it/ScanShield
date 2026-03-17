// api/search.js
// Vercel環境変数: SERPER_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, domain, serviceName, lang = 'en' } = req.body ?? {};
  if (!domain && !url) return res.status(200).json({ result: null });

  // 検索対象: serviceName があればそれを優先、なければ domain
  const target = serviceName || domain;

  // 検索クエリは常に英語で2本のみ（言語に依存しない）
  // 1. リスク検索: "サービス名 scam" — 詐欺報告を探す
  // 2. 評判検索:   "サービス名 official" — 本物かどうかを確認
  const queryRisk = `"${target}" scam phishing`;
  const queryRep  = `"${target}" official site`;

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRisk, gl: 'us', hl: 'en', num: 4 }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),

      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRep, gl: 'us', hl: 'en', num: 4 }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),
    ]);

    let ctx = '[SEARCH]\n';
    [[r1, 'Risk'], [r2, 'Official']].forEach(([r, label]) => {
      if (!r?.organic) return;
      ctx += `[${label}]\n`;
      r.organic.slice(0, 3).forEach(x =>
        ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 120)}\n`
      );
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    console.error('search error:', e);
    return res.status(200).json({ result: null });
  }
}
