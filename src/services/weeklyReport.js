import { supabase } from '../db/index.js';
import { sendEmail, weeklyReportEmailHtml } from './email.js';

export async function sendWeeklyReports() {
  console.log('[weeklyReport] Iniciando relatórios semanais...');

  const { data: users } = await supabase.from('users').select('id, name, email');
  if (!users?.length) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);
  const since = weekAgo.toISOString();

  const now = new Date();
  const period = `${weekAgo.toLocaleDateString('pt-BR')} – ${now.toLocaleDateString('pt-BR')}`;

  for (const user of users) {
    try {
      const { data: rawSites } = await supabase.from('sites')
        .select('id, name').eq('user_id', user.id);
      if (!rawSites?.length) continue;

      const siteIds = rawSites.map((s) => s.id);

      const [{ count: cliques }, { count: conversoes }] = await Promise.all([
        supabase.from('events').select('*', { count: 'exact', head: true })
          .in('site_id', siteIds).gte('created_at', since),
        supabase.from('conversions').select('*', { count: 'exact', head: true })
          .in('site_id', siteIds).gte('created_at', since),
      ]);

      if (!cliques) continue;

      const taxa = cliques > 0 ? Math.round(((conversoes || 0) / cliques) * 100) : 0;

      const sites = await Promise.all(rawSites.map(async (s) => {
        const [{ count: c }, { count: cv }] = await Promise.all([
          supabase.from('events').select('*', { count: 'exact', head: true })
            .eq('site_id', s.id).gte('created_at', since),
          supabase.from('conversions').select('*', { count: 'exact', head: true })
            .eq('site_id', s.id).gte('created_at', since),
        ]);
        return {
          name: s.name,
          cliques: c || 0,
          conversoes: cv || 0,
          taxa: c > 0 ? Math.round(((cv || 0) / c) * 100) : 0,
        };
      }));

      await sendEmail({
        to: user.email,
        subject: `📊 Resumo semanal — ${cliques} cliques, ${conversoes || 0} conversões`,
        html: weeklyReportEmailHtml({
          userName: user.name,
          period,
          stats: { cliques, conversoes: conversoes || 0, taxa },
          sites,
        }),
      });
    } catch (err) {
      console.error(`[weeklyReport] Erro para ${user.email}:`, err.message);
    }
  }

  console.log('[weeklyReport] Concluído.');
}
