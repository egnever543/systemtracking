import { supabase } from '../db/index.js';
import { getPlan } from '../config/plans.js';

export async function getUserUsage(userId) {
  const { data: userRow } = await supabase.from('users')
    .select('plan_slug, billing_cycle')
    .eq('id', userId)
    .maybeSingle();

  const planSlug = userRow?.plan_slug || 'trial';
  const plan = getPlan(planSlug);

  const { data: sites } = await supabase.from('sites').select('id').eq('user_id', userId);
  const siteCount = (sites || []).length;

  const mesAtual = new Date();
  mesAtual.setUTCDate(1);
  mesAtual.setUTCHours(0, 0, 0, 0);

  let clicksThisMonth = 0;
  if ((sites || []).length > 0) {
    const siteIds = sites.map(s => s.id);
    const { count } = await supabase.from('events')
      .select('*', { count: 'exact', head: true })
      .in('site_id', siteIds)
      .gte('created_at', mesAtual.toISOString());
    clicksThisMonth = count || 0;
  }

  return {
    plan,
    billingCycle: userRow?.billing_cycle || 'monthly',
    clicksThisMonth,
    siteCount,
    clickLimitReached: plan.clickLimit !== -1 && clicksThisMonth >= plan.clickLimit,
    siteLimitReached: plan.siteLimit !== -1 && siteCount >= plan.siteLimit,
  };
}
