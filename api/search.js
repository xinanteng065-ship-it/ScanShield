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

  if (!process.env.SERPER_API_KEY) {
    console.error('[search] SERPER_API_KEY is not set');
    return res.status(200).json({ result: null });
  }

  const isJa = lang === 'ja';
  const gl = isJa ? 'jp' : 'us';
  const hl = isJa ? 'ja' : 'en';

  // 検索ターゲット：URLが短ければフルURL、長ければドメインのみ
  const useFullUrl = url && url.length <= 80;
  const riskTarget = useFullUrl ? `"${url}" OR "${domain}"` : `"${domain}"`;

  // サービス名がある場合はそれも検索クエリに使う（「不明なサービス」の精度改善）
  const repTarget = serviceName && serviceName !== domain
    ? `"${serviceName}" OR "${domain}"`
    : `"${domain}"`;

  const queryRisk = isJa
    ? `${riskTarget} 詐欺 フィッシング`
    : `${riskTarget} scam phishing`;
  const queryRep = isJa
    ? `${repTarget} 評判 安全 サービス`
    : `${repTarget} review legitimate service`;

  const fetchSerper = async (q) => {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, gl, hl, num: 5 }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) {
      console.error(`[search] Serper HTTP ${r.status} for query: ${q.slice(0, 80)}`);
      return null;
    }
    return r.json().catch(() => null);
  };

  try {
    const [r1, r2] = await Promise.allSettled([
      fetchSerper(queryRisk),
      fetchSerper(queryRep),
    ]);

    const res1 = r1.status === 'fulfilled' ? r1.value : null;
    const res2 = r2.status === 'fulfilled' ? r2.value : null;

    if (!res1 && !res2) {
      console.error('[search] Both Serper queries failed');
      return res.status(200).json({ result: null });
    }

    let ctx = '[WEB SEARCH RESULTS]\n';

    if (res1) {
      const hits = res1.organic ?? [];
      ctx += '[Scam/Threat search]\n';
      if (hits.length > 0) {
        hits.slice(0, 4).forEach(x =>
          ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 150)}\n`
        );
      } else {
        // 0件も明示 → AIが「詐欺報告なし＝安全の根拠」として使える
        ctx += '(No scam or phishing reports found)\n';
      }
    }

    if (res2) {
      const hits = res2.organic ?? [];
      ctx += '[Reputation search]\n';
      if (hits.length > 0) {
        hits.slice(0, 4).forEach(x =>
          ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 150)}\n`
        );
      } else {
        ctx += '(No reputation results found)\n';
      }
    }

    return res.status(200).json({ result: ctx });

  } catch (e) {
    console.error('[search] Unexpected error:', e.message);
    return res.status(200).json({ result: null });
  }
}
