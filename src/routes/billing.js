import { Hono } from 'hono';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSubscription, getSubscription } from '../services/mercadopago.js';
import { getSubscriptionBanner } from '../utils/subscription.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const billing = new Hono();

// GET /billing — página de status da assinatura (requer auth)
billing.get('/', (c) => {
  const user = c.get('user');
  const dbUser = db.select().from(users).where(eq(users.id, user.userId)).get();

  const now = new Date();
  const status = dbUser.subscriptionStatus || 'trialing';
  const trialEnd = dbUser.trialEndsAt ? new Date(dbUser.trialEndsAt) : null;
  const daysLeftTrial = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))) : 0;
  const subExpires = dbUser.subscriptionExpiresAt
    ? new Date(dbUser.subscriptionExpiresAt).toLocaleDateString('pt-BR')
    : '';

  let html = readFileSync(join(viewsDir, 'billing.html'), 'utf-8');
  html = html
    .replaceAll('{{userName}}', dbUser.name)
    .replaceAll('{{subscriptionStatus}}', status)
    .replaceAll('{{daysLeftTrial}}', daysLeftTrial)
    .replaceAll('{{subscriptionExpiresAt}}', subExpires)
    .replaceAll('{{planPrice}}', process.env.PLAN_PRICE || '97')
    .replaceAll('{{planName}}', process.env.PLAN_NAME || 'Plano Mensal')
    .replaceAll('{{subscriptionBanner}}', getSubscriptionBanner(user.userId));

  return c.html(html);
});

// POST /billing/subscribe — cria assinatura no MP e redireciona (requer auth)
billing.post('/subscribe', async (c) => {
  const user = c.get('user');

  if (!process.env.MP_ACCESS_TOKEN) {
    return c.redirect('/billing?erro=Pagamentos+n%C3%A3o+configurados+pelo+administrador');
  }

  const dbUser = db.select().from(users).where(eq(users.id, user.userId)).get();

  try {
    const sub = await createSubscription({ email: dbUser.email, userId: dbUser.id });

    if (!sub.init_point) {
      console.error('MP error:', sub);
      return c.redirect('/billing?erro=Erro+ao+criar+assinatura+no+Mercado+Pago');
    }

    db.update(users).set({ mpSubscriptionId: sub.id }).where(eq(users.id, user.userId)).run();

    return c.redirect(sub.init_point);
  } catch (err) {
    console.error('MP subscribe error:', err);
    return c.redirect('/billing?erro=Erro+ao+processar+pagamento');
  }
});

// POST /webhook/mp — webhook público do Mercado Pago (sem auth)
export async function webhookHandler(c) {
  const body = await c.req.json().catch(() => ({}));
  const { type, data } = body;

  if (!data?.id) return c.json({ ok: true });

  try {
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      const sub = await getSubscription(data.id);
      const dbUser = db.select().from(users)
        .where(eq(users.mpSubscriptionId, data.id)).get();

      if (!dbUser) return c.json({ ok: true });

      if (sub.status === 'authorized') {
        const nextPayment = sub.next_payment_date
          ? new Date(sub.next_payment_date)
          : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

        db.update(users).set({
          subscriptionStatus: 'active',
          subscriptionExpiresAt: nextPayment.toISOString(),
        }).where(eq(users.id, dbUser.id)).run();

      } else if (sub.status === 'cancelled' || sub.status === 'paused') {
        db.update(users).set({ subscriptionStatus: 'expired' })
          .where(eq(users.id, dbUser.id)).run();
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }

  return c.json({ ok: true });
}

export default billing;
