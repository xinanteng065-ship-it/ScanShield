// api/search.js
// Vercel環境変数: SERPER_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // analyze.js から渡される lang を受け取る
  const { url, domain, lang = 'en' } = req.body ?? {};
  if (!domain && !url) return res.status(200).json({ result: null });

  const isJa = lang === 'ja';
  
  // Serper API の地域設定を言語に合わせる
  // ja の場合は日本(jp/ja)、それ以外は米国(us/en)
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';

  // 検索クエリの構築
  const targetRisk = url ? `"${url}" OR "${domain}"` : `"${domain}"`;
  
  // 日本語の場合は日本のネット上の「怪しい」ワードで検索
  const queryRisk = isJa
    ? `${targetRisk} 詐欺 フィッシング 悪質 危険 サイト`
    : `${targetRisk} scam phishing fraud danger`;
    
  const queryRep = isJa
    ? `"${domain}" 評判 口コミ 安全性 レビュー`
    : `"${domain}" review legitimate safe reputation`;

  try {
    const [r1, r2] = await Promise.all([
      // リスクチェック
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRisk, gl, hl, num: 4 }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),

      // 評判チェック
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: queryRep, gl, hl, num: 4 }),
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null),
    ]);

    // AIに渡すための検索結果コンテキストを生成
    let ctx = '[SEARCH RESULTS]\n';
    [[r1, 'Safety/Risk Info'], [r2, 'Reputation/Reviews']].forEach(([r, label]) => {
      if (!r || !r.organic) return;
      ctx += `\n[${label}]\n`;
      r.organic.slice(0, 3).forEach(x => {
        const title = x.title ?? 'No Title';
        const snippet = x.snippet ?? '';
        ctx += `• ${title}: ${snippet.slice(0, 150)}\n`;
      });
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    console.error('Search API error:', e);
    return res.status(200).json({ result: null });
  }
}
