import { supabase } from '../db/index.js';

export async function getSubscriptionBanner(userId) {
  const { data: user } = await supabase.from('users')
    .select('subscription_status, trial_ends_at')
    .eq('id', userId)
    .maybeSingle();

  if (!user || user.subscription_status === 'active' || user.subscription_status === 'trialing') return '';

  if (user.subscription_status === 'expired') {
    return `<div class="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
      Sua assinatura expirou.
      <a href="/billing" class="font-semibold underline ml-1">Renove agora</a> para continuar usando.
    </div>`;
  }

  return '';
}
