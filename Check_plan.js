// api/check-plan.js
// Vercel環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body ?? {};
  if (!email || !email.includes('@')) {
    return res.status(200).json({ plan: 'free' });
  }

  // Supabaseがまだ設定されていない場合は安全にfreeを返す
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(200).json({ plan: 'free' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data, error } = await supabase
      .from('subscribers')
      .select('plan, status, activated_at')
      .eq('email', email.toLowerCase().trim())
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return res.status(200).json({ plan: 'free' });
    }

    return res.status(200).json({ plan: data.plan, activatedAt: data.activated_at });
  } catch (e) {
    console.error('check-plan error:', e);
    return res.status(200).json({ plan: 'free' });
  }
}