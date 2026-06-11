import Stripe from 'stripe';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

export const STRIPE_PRICE_IDS = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || null,
    annual:  process.env.STRIPE_PRICE_STARTER_ANNUAL  || null,
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || null,
    annual:  process.env.STRIPE_PRICE_PRO_ANNUAL  || null,
  },
  agency: {
    monthly: process.env.STRIPE_PRICE_AGENCY_MONTHLY || null,
    annual:  process.env.STRIPE_PRICE_AGENCY_ANNUAL  || null,
  },
};

export async function createStripeCheckoutSession({ userId, email, planSlug, billingCycle, successUrl, cancelUrl }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured — set STRIPE_SECRET_KEY');

  const priceId = STRIPE_PRICE_IDS[planSlug]?.[billingCycle];
  if (!priceId) throw new Error(`Price ID not configured for ${planSlug}/${billingCycle}. Set STRIPE_PRICE_${planSlug.toUpperCase()}_${billingCycle.toUpperCase()}`);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, planSlug, billingCycle },
  });

  return session;
}

export async function getStripeEvent(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) return null;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return null;
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return null;
  }
}

export async function cancelStripeSubscription(subscriptionId) {
  const stripe = getStripe();
  if (!stripe || !subscriptionId) return;
  await stripe.subscriptions.cancel(subscriptionId);
}
