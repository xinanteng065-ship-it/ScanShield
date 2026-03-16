// api/search.js
// Vercel環境変数: SERPER_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // serviceName（例: "えきねっと", "Amazon"）を新しく受け取るようにします
  const { url, domain, serviceName, lang = 'en' } = req.body ?? {};
  if (!domain && !url) return res.status(200).json({ result: null });

  const isJa = lang === 'ja';
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';

  // --- 検索クエリの最適化 ---
  
  // 1. 基本的なドメインのリスク検索
  const target = url ? `"${url}" OR "${domain}"` : `"${domain}"`;
  const queryRisk = isJa
    ? `${target} 詐欺 フィッシング 悪質 危険`
    : `${target} scam phishing fraud`;

  // 2. サービス名に基づいた「本物かどうか」の比較検索
  // サービス名がある場合、その「公式サイト」を検索して、今のドメインと比較しやすくします
  const queryRep = (isJa && serviceName)
    ? `"${serviceName}" 公式サイト 評判 "${domain}"`
    : (serviceName)
      ? `"${serviceName}" official website review "${domain}"`
      : `"${domain}" review legitimate safe`;

  // 3. 【追加】サービス名 + 詐欺 の複合検索 (偽装サイト発見用)
  const queryServiceScam = (isJa && serviceName)
    ? `"${serviceName}" 偽サイト 注意喚起 フィッシング`
    : (serviceName)
      ? `"${serviceName}" fake site phishing alert`
      : null;

  try {
    // 検索リクエストの配列を作成
    const tasks = [
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
      }).then(r => r.json()).catch(() => null)
    ];

    // serviceNameがある場合のみ、追加の検索を実行
    if (queryServiceScam) {
      tasks.push(
        fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: queryServiceScam, gl, hl, num: 4 }),
          signal: AbortSignal.timeout(6000),
        }).then(r => r.json()).catch(() => null)
      );
    }

    const results = await Promise.all(tasks);
    const labels = ['Risk Info', 'Official/Reputation', 'Service Alerts'];

    let ctx = '[SEARCH RESULTS]\n';
    results.forEach((r, i) => {
      if (!r || !r.organic) return;
      ctx += `\n[${labels[i]}]\n`;
      r.organic.slice(0, 3).forEach(x => {
        ctx += `• ${x.title}: ${x.snippet}\n`;
      });
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    console.error('Search API error:', e);
    return res.status(200).json({ result: null });
  }
}
