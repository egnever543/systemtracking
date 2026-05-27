import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapUser } from '../db/mappers.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSubscription, getSubscription } from '../services/mercadopago.js';
import { getSubscriptionBanner } from '../utils/subscription.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const billing = new Hono();

billing.get('/', async (c) => {
  const user = c.get('user');
  const { data: raw } = await supabase.from('users').select('*').eq('id', user.userId).maybeSingle();
  const dbUser = mapUser(raw);

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
    .replaceAll('{{subscriptionBanner}}', await getSubscriptionBanner(user.userId));

  return c.html(html);
});

billing.post('/subscribe', async (c) => {
  const user = c.get('user');

  if (!process.env.MP_ACCESS_TOKEN) {
    return c.redirect('/billing?erro=Pagamentos+n%C3%A3o+configurados+pelo+administrador');
  }

  const { data: raw } = await supabase.from('users').select('*').eq('id', user.userId).maybeSingle();
  const dbUser = mapUser(raw);

  try {
    const sub = await createSubscription({ email: dbUser.email, userId: dbUser.id });

    if (!sub.init_point) {
      console.error('MP error:', sub);
      return c.redirect('/billing?erro=Erro+ao+criar+assinatura+no+Mercado+Pago');
    }

    await supabase.from('users').update({ mp_subscription_id: sub.id }).eq('id', user.userId);

    return c.redirect(sub.init_point);
  } catch (err) {
    console.error('MP subscribe error:', err);
    return c.redirect('/billing?erro=Erro+ao+processar+pagamento');
  }
});

export async function webhookHandler(c) {
  const body = await c.req.json().catch(() => ({}));
  const { type, data } = body;

  if (!data?.id) return c.json({ ok: true });

  try {
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      const sub = await getSubscription(data.id);
      const { data: raw } = await supabase.from('users').select('*').eq('mp_subscription_id', data.id).maybeSingle();
      const dbUser = mapUser(raw);

      if (!dbUser) return c.json({ ok: true });

      if (sub.status === 'authorized') {
        const nextPayment = sub.next_payment_date
          ? new Date(sub.next_payment_date)
          : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

        await supabase.from('users').update({
          subscription_status: 'active',
          subscription_expires_at: nextPayment.toISOString(),
        }).eq('id', dbUser.id);

      } else if (sub.status === 'cancelled' || sub.status === 'paused') {
        await supabase.from('users').update({ subscription_status: 'expired' }).eq('id', dbUser.id);
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }

  return c.json({ ok: true });
}

export default billing;
