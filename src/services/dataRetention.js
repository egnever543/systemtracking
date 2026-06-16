import { supabase } from '../db/index.js';
import { getPlan } from '../config/plans.js';

export async function processDataRetention() {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, plan');

    if (error) throw error;

    for (const user of users) {
      const plan = getPlan(user.plan);
      const retentionDays = plan.retentionDays;
      if (!retentionDays) continue;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      const cutoffISO = cutoff.toISOString();

      const { data: sites } = await supabase
        .from('sites')
        .select('id')
        .eq('user_id', user.id);

      if (!sites?.length) continue;

      const siteIds = sites.map(s => s.id);

      await supabase
        .from('conversions')
        .delete()
        .in('site_id', siteIds)
        .lt('created_at', cutoffISO);

      await supabase
        .from('events')
        .delete()
        .in('site_id', siteIds)
        .lt('created_at', cutoffISO);
    }

    console.log('[dataRetention] cleanup completed at', new Date().toISOString());
  } catch (err) {
    console.error('[dataRetention] error:', err);
  }
}
