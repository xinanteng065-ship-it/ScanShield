// api/search.js
// Vercel環境変数: SERPER_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, domain, lang = 'en' } = req.body ?? {};
  if (!domain && !url) return res.status(200).json({ result: null });

  const isJa = lang === 'ja';
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';

  const targetRisk = url ? `"${url}" OR "${domain}"` : `"${domain}"`;
  const queryRisk = isJa
    ? `${targetRisk} 詐欺 フィッシング 悪質 危険`
    : `${targetRisk} scam phishing fraud`;
  const queryRep = isJa
    ? `"${domain}" 評判 口コミ 安全 レビュー`
    : `"${domain}" review legitimate safe`;

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRisk, gl, hl, num: 4 }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),

      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRep, gl, hl, num: 4 }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),
    ]);

    let ctx = '[SEARCH]\n';
    [[r1, 'Risk'], [r2, 'Rep']].forEach(([r, label]) => {
      if (!r) return;
      ctx += `[${label}]\n`;
      (r.organic ?? []).slice(0, 3).forEach(x =>
        ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 120)}\n`
      );
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    console.error('search error:', e);
    return res.status(200).json({ result: null });
  }
}
