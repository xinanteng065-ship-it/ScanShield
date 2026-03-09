// api/webhook.js
// Vercel環境変数: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//                 SUPABASE_URL, SUPABASE_SERVICE_KEY,
//                 STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// raw bodyが必要なのでbodyParserをオフ
export const config = { api: { bodyParser: false } };

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

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const PLAN_MAP = {
    [process.env.STRIPE_PRICE_PRO]:  'pro',
    [process.env.STRIPE_PRICE_TEAM]: 'team',
  };

  // 決済完了
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    if (!email) return res.status(200).json({ received: true, note: 'no email' });

    // line_itemsを取得（expand必要な場合あり）
    const priceId = session.metadata?.price_id
      ?? session.line_items?.data?.[0]?.price?.id;

    const plan = PLAN_MAP[priceId] ?? 'pro';

    const { error } = await supabase
      .from('subscribers')
      .upsert({
        email: email.toLowerCase(),
        plan,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        status: 'active',
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' });

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'DB error' });
    }
    console.log(`✅ Activated: ${email} → ${plan}`);
  }

  // サブスクリプション解約
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const { error } = await supabase
      .from('subscribers')
      .update({ status: 'cancelled', plan: 'free', updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', sub.customer);

    if (error) console.error('Supabase cancel error:', error);
    else console.log(`❌ Cancelled: customer ${sub.customer}`);
  }

  return res.status(200).json({ received: true });
}
