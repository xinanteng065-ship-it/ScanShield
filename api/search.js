// api/search.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, serviceName, lang = 'en' } = req.body ?? {};
  
  // サービス名がない場合はドメインで代用
  const queryBase = serviceName || domain;
  if (!queryBase) return res.status(200).json({ result: null });

  const isJa = lang === 'ja';
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';

  // --- クエリ設計：サービス名に集中 ---
  
  // 1. 公式サイト特定用（AIに「本物」のURLを教えるため）
  const qOfficial = isJa 
    ? `"${queryBase}" 公式サイト` 
    : `"${queryBase}" official website`;

  // 2. 詐欺情報の収集（そのサービスを騙った手口を確認するため）
  const qScam = isJa 
    ? `"${queryBase}" 詐欺メール フィッシング 偽サイト` 
    : `"${queryBase}" phishing scam alert`;

  // 3. ドメインそのものの評判（念のため）
  const qDomain = `"${domain}" 評判 安全性`;

  try {
    const tasks = [
      { q: qOfficial, label: 'Official Sources' },
      { q: qScam, label: 'Scam Alerts' },
      { q: qDomain, label: 'Domain Reputation' }
    ].map(task => 
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: task.q, gl, hl, num: 3 }), // 精度重視で件数を絞る
        signal: AbortSignal.timeout(6000),
      }).then(r => r.json()).catch(() => null)
    );

    const results = await Promise.all(tasks);
    const labels = ['Official Sources', 'Scam Alerts', 'Domain Reputation'];

    let ctx = `[WEB_SEARCH_CONTEXT]\nTarget Service Name: ${queryBase}\nTarget Domain: ${domain}\n`;
    
    results.forEach((r, i) => {
      if (!r || !r.organic) return;
      ctx += `\n### ${labels[i]}\n`;
      r.organic.forEach(x => {
        // AIがドメインを比較しやすいよう、URLを強調して含める
        ctx += `• Title: ${x.title}\n  URL: ${x.link}\n  Snippet: ${x.snippet}\n`;
      });
    });

    return res.status(200).json({ result: ctx });
  } catch (e) {
    return res.status(200).json({ result: null });
  }
}
