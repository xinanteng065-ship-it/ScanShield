// api/stripe-webhook.js
// Stripe Webhook — サブスクリプション変更をリアルタイムで検知
//
// 環境変数:
//   STRIPE_SECRET_KEY         — sk_live_xxxxxxx
//   STRIPE_WEBHOOK_SECRET     — whsec_xxxxxxx（Stripe Dashboard > Webhooks で取得）
//   SUPABASE_URL              — https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service_role key（管理者権限）
//
// Stripe Dashboard で以下のイベントを有効化:
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_succeeded
//   invoice.payment_failed

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Vercel はbodyをバッファとして受け取る設定が必要
export const config = {
  api: { bodyParser: false },
};

// raw bodyを取得
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRO_PRICE_ID]:  'pro',
  [process.env.STRIPE_TEAM_PRICE_ID]: 'team',
  [process.env.STRIPE_PRO_PRICE_ID_TEST]:  'pro',
  [process.env.STRIPE_TEAM_PRICE_ID_TEST]: 'team',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Supabase クライアント（service role）
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        if (!email) break;

        // プラン判定
        let plan = 'free';
        if (sub.status === 'active' || sub.status === 'trialing') {
          for (const item of sub.items.data) {
            const p = PRICE_TO_PLAN[item.price.id];
            if (p) { plan = p; break; }
          }
        }

        // Supabase の user_plans テーブルを upsert
        await supabase.from('user_plans').upsert({
          email: email.toLowerCase(),
          plan,
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });

        console.log(`Plan updated: ${email} → ${plan} (${sub.status})`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        if (!email) break;

        await supabase.from('user_plans').upsert({
          email: email.toLowerCase(),
          plan: 'free',
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });

        console.log(`Subscription canceled: ${email} → free`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          const customer = await stripe.customers.retrieve(sub.customer);
          const email = customer.email;
          if (email) {
            await supabase.from('user_plans').upsert({
              email: email.toLowerCase(),
              plan: 'free',
              subscription_status: 'past_due',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'email' });
            console.log(`Payment failed: ${email} → downgraded to free`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Stripe には 200 を返す（再送ループを防ぐ）
    return res.status(200).json({ received: true, error: err.message });
  }

  return res.status(200).json({ received: true });
}