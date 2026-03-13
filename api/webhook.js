import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export const config = {
  api: { bodyParser: false },
};

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
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    switch (event.type) {
      // 1. 【追加】決済が完了した瞬間の処理
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (!session.subscription) break;
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const customer = await stripe.customers.retrieve(session.customer);
        const email = customer.email;
        if (!email) break;

        let plan = 'free';
        for (const item of sub.items.data) {
          const p = PRICE_TO_PLAN[item.price.id];
          if (p) { plan = p; break; }
        }

        await supabase.from('user_plans').upsert({
          email: email.toLowerCase(),
          plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
        console.log(`Checkout success: ${email} → ${plan}`);
        break;
      }

      // 2. サブスクが更新・作成された時の処理
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        if (!email) break;

        let plan = 'free';
        if (sub.status === 'active' || sub.status === 'trialing') {
          for (const item of sub.items.data) {
            const p = PRICE_TO_PLAN[item.price.id];
            if (p) { plan = p; break; }
          }
        }

        // 【修正】日付エラーを防ぐためのガード
        const periodEnd = sub.current_period_end 
          ? new Date(sub.current_period_end * 1000).toISOString() 
          : new Date().toISOString();

        await supabase.from('user_plans').upsert({
          email: email.toLowerCase(),
          plan,
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
        console.log(`Plan updated: ${email} → ${plan}`);
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
          subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }

  return res.status(200).json({ received: true });
}
