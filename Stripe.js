// api/webhook.js
// Stripe決済完了 → Supabaseにプラン保存
//
// ✅ Vercelの環境変数に以下を設定してください:
//   STRIPE_WEBHOOK_SECRET  → Stripeダッシュボード > Webhooks > signing secret
//   SUPABASE_URL           → SupabaseプロジェクトURL
//   SUPABASE_SERVICE_KEY   → Supabase > Settings > API > service_role key

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Stripe raw bodyが必要なのでbodyParserをオフ
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// プランIDマッピング（StripeのProduct IDと対応させる）
// ✅ Stripeダッシュボード > Products で確認してIDを設定
const PLAN_MAP = {
  [process.env.STRIPE_PRICE_PRO]:  'pro',
  [process.env.STRIPE_PRICE_TEAM]: 'team',
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // 決済完了イベント
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const priceId = session.line_items?.data?.[0]?.price?.id
      ?? session.metadata?.price_id;

    if (!email) {
      return res.status(200).json({ received: true, note: 'no email' });
    }

    const plan = PLAN_MAP[priceId] ?? 'pro'; // fallback pro
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Supabaseにupsert（なければ作成、あれば更新）
    const { error } = await supabase
      .from('subscribers')
      .upsert({
        email: email.toLowerCase(),
        plan,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        status: 'active',
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' });

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'DB error' });
    }

    console.log(`✅ Plan activated: ${email} → ${plan}`);
  }

  // サブスクリプション解約イベント
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerId = sub.customer;

    const { error } = await supabase
      .from('subscribers')
      .update({ status: 'cancelled', plan: 'free', updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', customerId);

    if (error) console.error('Supabase cancel error:', error);
    else console.log(`❌ Subscription cancelled: customer ${customerId}`);
  }

  return res.status(200).json({ received: true });
}