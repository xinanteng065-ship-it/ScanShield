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

  const target = serviceName || domain;
  const isJa = lang === 'ja';
  
  // ⭐️ ここが最重要！日本語の場合は日本のGoogle(jp/ja)で検索する
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';

  // 検索クエリも言語に合わせて変更（日本語サイトを英語で検索すると精度が落ちるため）
  const queryRisk = isJa ? `"${target}" 詐欺 フィッシング 悪質` : `"${target}" scam phishing`;
  const queryRep  = isJa ? `"${target}" 公式サイト 評判` : `"${target}" official site`;

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRisk, gl, hl, num: 4 }), // 動的な gl, hl を使用
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),

      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRep, gl, hl, num: 4 }), // 動的な gl, hl を使用
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),
    ]);

    let ctx = '[SEARCH]\n';
    [[r1, 'Risk'], [r2, 'Official']].forEach(([r, label]) => {
      if (!r?.organic) return;
      ctx += `[${label}]\n`;
      r.organic.slice(0, 3).forEach(x => {
        // URLもAIに渡すことで、公式ドメインとの不一致を見抜きやすくする
        ctx += `• ${x.title ?? ''}\n  URL: ${x.link ?? ''}\n  Snippet: ${(x.snippet ?? '').slice(0, 120)}\n`;
      });
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    console.error('search error:', e);
    return res.status(200).json({ result: null });
  }
}
