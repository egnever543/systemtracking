import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapUser } from '../db/mappers.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSubscription, getSubscription } from '../services/mercadopago.js';
import { getSubscriptionBanner } from '../utils/subscription.js';
import { getPlan, PLANS } from '../config/plans.js';
import { getUserUsage } from '../utils/planUsage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const billing = new Hono();

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPlanCardsHtml(currentPlanSlug, billingCycle) {
  const plansToShow = ['starter', 'pro', 'agency'];
  return plansToShow.map(slug => {
    const plan = PLANS[slug];
    const isCurrent = currentPlanSlug === slug;
    const isPopular = slug === 'pro';
    const monthlyPrice = plan.monthlyPrice;
    const annualPrice = plan.annualPrice;
    const annualTotal = annualPrice * 12;

    const borderClass = isCurrent ? 'border-2 border-wa' : 'border border-gray-200';
    const featuresHtml = plan.features.map(f => `<li class="flex items-start gap-2 text-sm text-gray-600"><span class="text-wa font-bold mt-0.5">✓</span><span>${escHtml(f)}</span></li>`).join('');
    const clicksLabel = plan.clickLimit === -1 ? 'Ilimitado' : plan.clickLimit.toLocaleString('pt-BR') + ' cliques/mês';
    const sitesLabel = plan.siteLimit === -1 ? 'Sites ilimitados' : plan.siteLimit + ' sites';

    const badgesHtml = [
      isCurrent ? '<span class="inline-block bg-wa text-white text-xs font-semibold px-2 py-0.5 rounded-full">Plano atual</span>' : '',
      isPopular && !isCurrent ? '<span class="inline-block bg-amber-400 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Mais popular</span>' : '',
    ].filter(Boolean).join(' ');

    return `
    <div class="plan-card bg-white ${borderClass} rounded-xl p-6 flex flex-col" data-plan="${slug}">
      <div class="flex items-start justify-between mb-1">
        <h3 class="text-lg font-bold text-gray-900">${escHtml(plan.name)}</h3>
        <div class="flex gap-1">${badgesHtml}</div>
      </div>
      <div class="mb-4">
        <div class="price-monthly" style="display:${billingCycle === 'annual' ? 'none' : 'block'}">
          <span class="text-3xl font-extrabold text-gray-900">R$ ${monthlyPrice}</span>
          <span class="text-gray-400 text-sm">/mês</span>
        </div>
        <div class="price-annual" style="display:${billingCycle === 'annual' ? 'block' : 'none'}">
          <span class="text-3xl font-extrabold text-gray-900">R$ ${annualPrice}</span>
          <span class="text-gray-400 text-sm">/mês</span>
          <p class="text-xs text-gray-400 mt-0.5">R$ ${annualPrice} × 12 = R$ ${annualTotal}/ano</p>
        </div>
      </div>
      <ul class="space-y-2 mb-4">
        <li class="flex items-center gap-2 text-sm font-medium text-gray-700"><span class="text-wa">✓</span>${clicksLabel}</li>
        <li class="flex items-center gap-2 text-sm font-medium text-gray-700"><span class="text-wa">✓</span>${sitesLabel}</li>
        ${featuresHtml}
      </ul>
      <div class="mt-auto">
        <form method="POST" action="/billing/subscribe">
          <input type="hidden" name="plan" value="${slug}">
          <input type="hidden" name="cycle" class="cycle-input" value="${billingCycle}">
          <button type="submit" class="w-full ${isCurrent ? 'bg-gray-100 text-gray-500 cursor-default' : 'bg-wa hover:bg-wa-dark text-white'} font-semibold py-2.5 rounded-xl transition-colors text-sm">
            ${isCurrent ? 'Plano atual' : 'Assinar'}
          </button>
        </form>
      </div>
    </div>`;
  }).join('');
}

billing.get('/', async (c) => {
  const user = c.get('user');
  const { data: raw } = await supabase.from('users').select('*').eq('id', user.userId).maybeSingle();
  const dbUser = mapUser(raw);

  if (!dbUser) return c.redirect('/login');

  const now = new Date();
  const status = dbUser.subscriptionStatus || 'trialing';
  const trialEnd = dbUser.trialEndsAt ? new Date(dbUser.trialEndsAt) : null;
  const daysLeftTrial = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))) : 0;
  const subExpires = dbUser.subscriptionExpiresAt
    ? new Date(dbUser.subscriptionExpiresAt).toLocaleDateString('pt-BR')
    : '';

  const currentPlanSlug = dbUser.planSlug || 'trial';
  const billingCycle = dbUser.billingCycle || 'monthly';
  const planDataJSON = JSON.stringify({
    plans: Object.values(PLANS),
    currentPlanSlug,
    billingCycle,
  });
  const planCardsHtml = buildPlanCardsHtml(currentPlanSlug, billingCycle);

  let html = readFileSync(join(viewsDir, 'billing.html'), 'utf-8');
  html = html
    .replaceAll('{{userName}}', dbUser.name)
    .replaceAll('{{subscriptionStatus}}', status)
    .replaceAll('{{daysLeftTrial}}', daysLeftTrial)
    .replaceAll('{{subscriptionExpiresAt}}', subExpires)
    .replaceAll('{{planPrice}}', process.env.PLAN_PRICE || '97')
    .replaceAll('{{planName}}', process.env.PLAN_NAME || 'Plano Mensal')
    .replaceAll('{{subscriptionBanner}}', await getSubscriptionBanner(user.userId))
    .replaceAll('{{planDataJSON}}', planDataJSON.replace(/</g, '\\u003c').replace(/>/g, '\\u003e'))
    .replaceAll('{{planCardsHtml}}', planCardsHtml);

  return c.html(html);
});

billing.post('/subscribe', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody().catch(() => ({}));

  const planChoice = ['starter', 'pro', 'agency'].includes(body.plan) ? body.plan : 'starter';
  const cycleChoice = body.cycle === 'annual' ? 'annual' : 'monthly';

  const { data: raw } = await supabase.from('users').select('*').eq('id', user.userId).maybeSingle();
  const dbUser = mapUser(raw);

  // Save plan/cycle selection regardless of payment flow
  await supabase.from('users').update({ plan_slug: planChoice, billing_cycle: cycleChoice }).eq('id', user.userId);

  if (!process.env.MP_ACCESS_TOKEN) {
    return c.redirect('/billing?msg=Plano+selecionado+com+sucesso');
  }

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
