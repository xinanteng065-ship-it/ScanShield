// 内部関数: ドメイン・URLの検索を実行
async function getSearchContext(url, domain, isJa) {
  if (!process.env.SERPER_API_KEY) return "";
  
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';
  const target = url ? `"${url}" OR "${domain}"` : `"${domain}"`;
  
  const queryRisk = isJa ? `${target} 詐欺 フィッシング 危険` : `${target} scam phishing fraud`;
  const queryRep = isJa ? `"${domain}" 評判 安全 レビュー` : `"${domain}" review legitimate safe`;

  try {
    const fetchSearch = (q) => fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl, hl, num: 4 }),
      signal: AbortSignal.timeout(5000),
    }).then(res => res.json()).catch(() => null);

    const [r1, r2] = await Promise.all([fetchSearch(queryRisk), fetchSearch(queryRep)]);

    let ctx = "\n--- Web Search Results ---\n";
    [[r1, 'Risk Check'], [r2, 'Reputation']].forEach(([r, label]) => {
      if (!r || !r.organic) return;
      ctx += `[${label}]\n`;
      r.organic.slice(0, 3).forEach(x => {
        ctx += `- ${x.title}: ${x.snippet}\n`;
      });
    });
    return ctx;
  } catch (e) {
    return "";
  }
}

// 判定関数
function isTrustedDomain(url) { /* 既存のロジック */ }
function isJapaneseSite(url) { /* 既存のロジック */ }

export default async function handler(req, res) {
  // CORS設定などは省略（既存通り）

  const { message, history = [], lang = 'en' } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'No message' });

  const urlMatch = message.match(/https?:\/\/[^\s\n]+/);
  const targetUrl = urlMatch ? urlMatch[0] : null;
  let domain = "";
  try { if(targetUrl) domain = new URL(targetUrl).hostname; } catch(e){}

  const isJa = lang === 'ja';
  const trusted = targetUrl ? isTrustedDomain(targetUrl) : false;
  const siteIsJp = targetUrl ? isJapaneseSite(targetUrl) : false;

  // 1. 検索を実行して外部情報を取得
  const searchInfo = (targetUrl && !trusted) 
    ? await getSearchContext(targetUrl, domain, isJa) 
    : "";

  // 2. AIへの指示を構築
  const systemPrompt = `あなたは公平なウェブセキュリティアナリストです。
提供された [Web Search Results] を分析し、URLの安全性を判定してください。
${siteIsJp ? '日本向けサービスとして評価してください。' : 'Global context.'}
${trusted ? '重要: これは著名ドメインです。✅ 安全 としてください。' : ''}

ルール: ✅ 安全, ⚠️ 注意, 🚨 危険。
迷ったら ✅ 安全 を優先してください。ただし、検索結果に強い警告や被害報告がある場合は 🚨 危険 とします。

回答フォーマット:
サービス名: [名称]
目的: [概要]
安全性: [判定] — [理由]
アドバイス: [1つ]`;

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
          ...history.slice(-4),
          { role: 'user', content: `Analyze this URL: ${targetUrl || message}\n${searchInfo}` },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await r.json();
    return res.status(200).json({ reply: data.choices?.[0]?.message?.content });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
