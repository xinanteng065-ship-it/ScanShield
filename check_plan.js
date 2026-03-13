// api/check-plan.js（最終版）
// 戦略: Supabase DBを先に参照（高速）→ なければStripe APIに直接問い合わせ（フォールバック）
//
// 環境変数（Vercel Dashboard > Settings > Environment Variables）:
//   STRIPE_SECRET_KEY         — sk_live_xxxxxxx
//   STRIPE_PRO_PRICE_ID       — price_xxxxxxx（本番ProのPrice ID）
//   STRIPE_TEAM_PRICE_ID      — price_xxxxxxx（本番TeamのPrice ID）
//   SUPABASE_URL              — https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service_role key

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ plan: 'free' });

  const { email } = req.body ?? {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ plan: 'free' });
  }
  const normalizedEmail = email.toLowerCase().trim();

  // ── Step 1: Supabase DBを先に確認（Webhookで同期済みなら即返答）──
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const { data, error } = await supabase
        .from('user_plans')
        .select('plan, subscription_status, current_period_end')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (!error && data) {
        const isActive = ['active', 'trialing'].includes(data.subscription_status);
        const notExpired = !data.current_period_end ||
          new Date(data.current_period_end) > new Date();

        if (isActive && notExpired && data.plan !== 'free') {
          return res.status(200).json({ plan: data.plan, source: 'db' });
        }
        // DBにfreeまたはキャンセル済みなら、Stripeでダブルチェック
      }
    } catch (e) {
      console.warn('Supabase lookup failed, falling back to Stripe:', e.message);
    }
  }

  // ── Step 2: Stripe APIに直接問い合わせ（フォールバック）──
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(200).json({ plan: 'free' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
  });

  const PRICE_TO_PLAN = {};
  if (process.env.STRIPE_PRO_PRICE_ID)  PRICE_TO_PLAN[process.env.STRIPE_PRO_PRICE_ID]  = 'pro';
  if (process.env.STRIPE_TEAM_PRICE_ID) PRICE_TO_PLAN[process.env.STRIPE_TEAM_PRICE_ID] = 'team';

  try {
    const customers = await stripe.customers.list({
      email: normalizedEmail,
      limit: 5,
    });

    if (customers.data.length === 0) {
      return res.status(200).json({ plan: 'free', source: 'stripe' });
    }

    for (const customer of customers.data) {
      for (const status of ['active', 'trialing']) {
        const subs = await stripe.subscriptions.list({
          customer: customer.id,
          status,
          expand: ['data.items.data.price'],
          limit: 5,
        });

        for (const sub of subs.data) {
          for (const item of sub.items.data) {
            const plan = PRICE_TO_PLAN[item.price.id];
            if (plan) {
              syncPlanToDb(normalizedEmail, plan, customer.id, sub.id, sub.status, sub.current_period_end);
              return res.status(200).json({
                plan,
                source: 'stripe',
                customerId: customer.id,
                subscriptionId: sub.id,
              });
            }
          }
        }
      }
    }

    return res.status(200).json({ plan: 'free', source: 'stripe' });

  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(200).json({ plan: 'free', error: err.message });
  }
}

// DB同期（非ブロッキング）
async function syncPlanToDb(email, plan, customerId, subscriptionId, status, periodEnd) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    await supabase.from('user_plans').upsert({
      email,
      plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });
  } catch (e) {
    console.warn('DB sync failed:', e.message);
  }
}