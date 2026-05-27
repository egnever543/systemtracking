import { supabase } from '../db/index.js';

export async function getSubscriptionBanner(userId) {
  const { data: user } = await supabase.from('users')
    .select('subscription_status, trial_ends_at')
    .eq('id', userId)
    .maybeSingle();

  if (!user || user.subscription_status === 'active') return '';

  const now = new Date();

  if (!user.subscription_status || user.subscription_status === 'trialing') {
    const trialEnd = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    if (!trialEnd) return '';

    const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));

    if (daysLeft > 0) {
      return `<div class="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
        Seu trial termina em <strong>${daysLeft} dia${daysLeft !== 1 ? 's' : ''}</strong>.
        <a href="/billing" class="font-semibold underline ml-1">Assine agora</a> para continuar sem interrupções.
      </div>`;
    }

    return `<div class="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
      Seu período de teste expirou.
      <a href="/billing" class="font-semibold underline ml-1">Assine agora</a> para continuar usando.
    </div>`;
  }

  if (user.subscription_status === 'expired') {
    return `<div class="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
      Sua assinatura expirou.
      <a href="/billing" class="font-semibold underline ml-1">Renove agora</a> para continuar usando.
    </div>`;
  }

  return '';
}
