import { supabase } from '../db/index.js';
import { sendConversionEvent } from './facebookCapi.js';

export async function processLostLeads() {
  console.log('[lostLeads] Iniciando processamento...');

  const { data: sites, error } = await supabase
    .from('sites')
    .select('id, name, lost_leads_window_hours, lost_leads_event_name, fb_pixel_id, fb_access_token, fb_test_event_code, fb_pixels')
    .eq('lost_leads_enabled', true);

  if (error || !sites?.length) {
    console.log('[lostLeads] Nenhum site ativo.');
    return;
  }

  let totalProcessed = 0;

  for (const site of sites) {
    try {
      const windowHours = site.lost_leads_window_hours ?? 24;
      const eventName = site.lost_leads_event_name || 'LeadAbandoned';
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

      const { data: convRows } = await supabase
        .from('conversions')
        .select('event_id')
        .eq('site_id', site.id);

      const convertedIds = (convRows || []).map(r => r.event_id).filter(Boolean);

      let query = supabase
        .from('events')
        .select('id, tracking_id, fbclid, page_url, ip_original, user_agent, created_at')
        .eq('site_id', site.id)
        .lt('created_at', cutoff)
        .is('lost_processed_at', null)
        .limit(200);

      if (convertedIds.length > 0) {
        query = query.not('id', 'in', `(${convertedIds.join(',')})`);
      }

      const { data: lostEvents } = await query;
      if (!lostEvents?.length) continue;

      const pixels = [];
      if (site.fb_pixel_id && site.fb_access_token) {
        pixels.push({ pixelId: site.fb_pixel_id, accessToken: site.fb_access_token, testEventCode: site.fb_test_event_code ?? null });
      }
      const extra = Array.isArray(site.fb_pixels) ? site.fb_pixels : [];
      for (const px of extra) {
        if (px.pixelId && px.accessToken) {
          pixels.push({ pixelId: px.pixelId, accessToken: px.accessToken, testEventCode: px.testEventCode ?? null });
        }
      }

      for (const event of lostEvents) {
        for (const px of pixels) {
          sendConversionEvent({
            pixelId: px.pixelId,
            accessToken: px.accessToken,
            testEventCode: px.testEventCode,
            trackingId: `lost_${event.tracking_id}`,
            pageUrl: event.page_url,
            fbclid: event.fbclid,
            eventCreatedAt: event.created_at,
            ipOriginal: event.ip_original,
            userAgent: event.user_agent,
            eventName,
            value: null,
            currency: 'BRL',
          }).catch(() => {});
        }

        await supabase
          .from('events')
          .update({ lost_processed_at: new Date().toISOString() })
          .eq('id', event.id);

        totalProcessed++;
      }
    } catch (err) {
      console.error(`[lostLeads] Erro no site ${site.id}:`, err.message);
    }
  }

  console.log(`[lostLeads] Concluído. ${totalProcessed} leads processados.`);
}
