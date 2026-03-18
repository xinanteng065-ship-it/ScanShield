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

  const fetchSerper = async (q, extra = {}) => {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, gl, hl, num: 5, ...extra }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) {
      console.error(`[search] Serper HTTP ${r.status}`);
      return null;
    }
    return r.json().catch(() => null);
  };

  // ── 3つのクエリを並列実行 ──────────────────────────────────────
  // 1) サイト自体の説明・概要を取得（site:ドメイン OR ドメイン名で検索）
  //    → answerBox, knowledgeGraph, sitelinks にサービス情報が入る
  // 2) 詐欺・フィッシング報告
  // 3) 評判・レビュー（サービス名 or ドメイン）
  const nameTarget = serviceName && serviceName !== domain ? serviceName : domain;
  const q1 = `site:${domain}`;                                          // サイト内コンテンツ
  const q2 = isJa ? `"${domain}" 詐欺 フィッシング` : `"${domain}" scam phishing fraud`;
  const q3 = isJa ? `${nameTarget} サービス 概要` : `${nameTarget} service about`;

  const [r1, r2, r3] = await Promise.allSettled([
    fetchSerper(q1),
    fetchSerper(q2),
    fetchSerper(q3),
  ]);

  const d1 = r1.status === 'fulfilled' ? r1.value : null;
  const d2 = r2.status === 'fulfilled' ? r2.value : null;
  const d3 = r3.status === 'fulfilled' ? r3.value : null;

  if (!d1 && !d2 && !d3) {
    console.error('[search] All Serper queries failed');
    return res.status(200).json({ result: null });
  }

  let ctx = '[WEB SEARCH RESULTS]\n\n';

  // ── [1] サイト概要（最重要） ──────────────────────────────────
  ctx += '[SITE INFO]\n';
  let siteInfoFound = false;

  // answerBox: Googleが直接まとめた回答（企業説明など）
  const ab = d1?.answerBox || d3?.answerBox;
  if (ab) {
    const abText = ab.answer || ab.snippet || ab.title || '';
    if (abText) { ctx += `Summary: ${abText.slice(0, 300)}\n`; siteInfoFound = true; }
  }

  // knowledgeGraph: 企業・サービスの構造化情報
  const kg = d1?.knowledgeGraph || d3?.knowledgeGraph;
  if (kg) {
    if (kg.title)       ctx += `Name: ${kg.title}\n`;
    if (kg.type)        ctx += `Type: ${kg.type}\n`;
    if (kg.description) ctx += `Description: ${kg.description.slice(0, 300)}\n`;
    if (kg.website)     ctx += `Official site: ${kg.website}\n`;
    siteInfoFound = true;
  }

  // site: 検索のオーガニック結果（実際のページ一覧）
  const sitePages = d1?.organic ?? [];
  if (sitePages.length > 0) {
    ctx += `[Pages found on ${domain}]\n`;
    sitePages.slice(0, 4).forEach(x => {
      ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 150)}\n`;
    });
    siteInfoFound = true;
  }

  // sitelinks: Googleが把握しているサイト構造
  const sl = d1?.sitelinks || d3?.sitelinks;
  if (sl && sl.length > 0) {
    ctx += `[Sitelinks]\n`;
    sl.slice(0, 4).forEach(s => ctx += `• ${s.title}: ${s.link}\n`);
    siteInfoFound = true;
  }

  // サービス概要クエリの結果
  const aboutPages = d3?.organic ?? [];
  if (aboutPages.length > 0 && !siteInfoFound) {
    ctx += `[About "${nameTarget}"]\n`;
    aboutPages.slice(0, 3).forEach(x => {
      ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 150)}\n`;
    });
    siteInfoFound = true;
  }

  if (!siteInfoFound) {
    ctx += `(No indexed content found for ${domain} — domain may be very new or low-traffic)\n`;
  }

  // ── [2] 詐欺・フィッシング報告 ───────────────────────────────
  ctx += '\n[SCAM/THREAT REPORTS]\n';
  const scamHits = d2?.organic ?? [];
  if (scamHits.length > 0) {
    scamHits.slice(0, 4).forEach(x =>
      ctx += `• ${x.title ?? ''}: ${(x.snippet ?? '').slice(0, 150)}\n`
    );
  } else {
    ctx += '(No scam or phishing reports found — this is a positive signal)\n';
  }

  return res.status(200).json({ result: ctx });
}
