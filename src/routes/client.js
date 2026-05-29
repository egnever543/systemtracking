import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapSite, mapEvent } from '../db/mappers.js';
import { sendConversionEvent } from '../services/facebookCapi.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const client = new Hono();

async function resolveToken(c, next) {
  const { token } = c.req.param();
  const { data: rawSite } = await supabase.from('sites')
    .select('*')
    .eq('client_token', token)
    .maybeSingle();

  if (!rawSite || !rawSite.client_access_enabled) {
    return c.html('<html><body style="font-family:sans-serif;padding:2rem"><h2>Portal não encontrado ou acesso desativado.</h2><p>Solicite um novo link ao seu gestor.</p></body></html>', 404);
  }

  c.set('site', mapSite(rawSite));
  return next();
}

client.get('/:token', resolveToken, (c) => {
  const site = c.get('site');
  const token = c.req.param('token');
  let html = readFileSync(join(viewsDir, 'client/dashboard.html'), 'utf-8');
  html = html.replaceAll('{{siteName}}', site.name).replaceAll('{{token}}', token);
  return c.html(html);
});

client.get('/:token/api/stats', resolveToken, async (c) => {
  const site = c.get('site');
  const siteId = site.id;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const mes = new Date(hoje);
  mes.setDate(1);

  const [
    { count: cliquesHoje },
    { count: cliquesMes },
    { count: totalCliques },
    { count: totalConversoes },
  ] = await Promise.all([
    supabase.from('events').select('*', { count: 'exact', head: true }).eq('site_id', siteId).gte('created_at', hoje.toISOString()),
    supabase.from('events').select('*', { count: 'exact', head: true }).eq('site_id', siteId).gte('created_at', mes.toISOString()),
    supabase.from('events').select('*', { count: 'exact', head: true }).eq('site_id', siteId),
    supabase.from('conversions').select('*', { count: 'exact', head: true }).eq('site_id', siteId),
  ]);

  const total = totalCliques || 0;
  const taxa = total > 0 ? Math.round(((totalConversoes || 0) / total) * 100) : 0;

  return c.json({
    cliquesHoje: cliquesHoje || 0,
    cliquesMes: cliquesMes || 0,
    totalCliques: total,
    totalConversoes: totalConversoes || 0,
    taxaConversao: taxa,
  });
});

client.get('/:token/api/chart', resolveToken, async (c) => {
  const site = c.get('site');
  const siteId = site.id;
  const days = 30;

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const { data: events } = await supabase.from('events')
    .select('id, created_at')
    .eq('site_id', siteId)
    .gte('created_at', since.toISOString());

  const eventIds = (events || []).map(e => e.id);
  let convSet = new Set();
  if (eventIds.length > 0) {
    const { data: convs } = await supabase.from('conversions').select('event_id').in('event_id', eventIds);
    convSet = new Set((convs || []).map(cv => cv.event_id));
  }

  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { date: key, cliques: 0, conversoes: 0 };
  }
  for (const ev of (events || [])) {
    const key = new Date(ev.created_at).toISOString().slice(0, 10);
    if (buckets[key]) {
      buckets[key].cliques++;
      if (convSet.has(ev.id)) buckets[key].conversoes++;
    }
  }

  return c.json(Object.values(buckets));
});

client.get('/:token/api/numbers-stats', resolveToken, async (c) => {
  const site = c.get('site');
  const siteId = site.id;

  const [{ data: events }, { data: convs }, { data: numbers }] = await Promise.all([
    supabase.from('events').select('id, selected_number').eq('site_id', siteId),
    supabase.from('conversions').select('event_id').eq('site_id', siteId),
    supabase.from('site_numbers').select('number, label').eq('site_id', siteId),
  ]);

  const convSet = new Set((convs || []).map(cv => cv.event_id));
  const labelMap = Object.fromEntries((numbers || []).map(n => [n.number, n.label || n.number]));

  const stats = {};
  for (const ev of (events || [])) {
    const num = ev.selected_number || '(padrão)';
    if (!stats[num]) stats[num] = { number: num, label: labelMap[num] || num, cliques: 0, conversoes: 0 };
    stats[num].cliques++;
    if (convSet.has(ev.id)) stats[num].conversoes++;
  }

  return c.json(
    Object.values(stats)
      .map(s => ({ ...s, taxa: s.cliques > 0 ? Math.round((s.conversoes / s.cliques) * 100) : 0 }))
      .sort((a, b) => b.cliques - a.cliques),
  );
});

client.get('/:token/api/conversions', resolveToken, async (c) => {
  const site = c.get('site');
  const siteId = site.id;
  const limit = Math.min(50, Math.max(5, parseInt(c.req.query('limit') || '25')));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));

  const [{ count: total }, { data: rows }] = await Promise.all([
    supabase.from('conversions').select('*', { count: 'exact', head: true }).eq('site_id', siteId),
    supabase.from('conversions')
      .select('id, event_id, value, currency, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  ]);

  const eventIds = (rows || []).map(r => r.event_id).filter(Boolean);
  let eventsMap = {};
  if (eventIds.length > 0) {
    const { data: evRows } = await supabase.from('events')
      .select('id, tracking_id, selected_number')
      .in('id', eventIds);
    for (const ev of (evRows || [])) eventsMap[ev.id] = ev;
  }

  return c.json({
    items: (rows || []).map(r => ({
      id: r.id,
      value: r.value,
      currency: r.currency,
      createdAt: r.created_at,
      trackingId: eventsMap[r.event_id]?.tracking_id || null,
      selectedNumber: eventsMap[r.event_id]?.selected_number || null,
    })),
    total: total || 0,
  });
});

client.get('/:token/api/lookup/:trackingId', resolveToken, async (c) => {
  const site = c.get('site');
  const { trackingId } = c.req.param();
  const id = trackingId.toUpperCase().trim();

  const { data: raw } = await supabase.from('events')
    .select('id, tracking_id, site_id, fbclid, page_url, click_params, ip_original, user_agent, created_at')
    .eq('tracking_id', id)
    .eq('site_id', site.id)
    .maybeSingle();

  if (!raw) return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);

  const event = mapEvent(raw);
  const { data: conv } = await supabase.from('conversions').select('id').eq('event_id', event.id).maybeSingle();

  return c.json({ ...event, siteName: site.name, jaConvertido: !!conv });
});

const VALID_EVENTS = ['Purchase', 'Lead', 'InitiateCheckout', 'AddToCart', 'ViewContent'];

client.post('/:token/api/conversions', resolveToken, async (c) => {
  const site = c.get('site');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ erro: 'Dados inválidos' }, 400);

  const { trackingId, value, currency, eventName = 'Purchase' } = body;
  if (!trackingId) return c.json({ erro: 'ID de rastreamento é obrigatório' }, 400);
  if (!VALID_EVENTS.includes(eventName)) return c.json({ erro: 'Tipo de evento inválido' }, 400);
  if (eventName === 'Purchase' && !value) return c.json({ erro: 'Valor é obrigatório para Venda' }, 400);

  const { data: rawEvent } = await supabase.from('events')
    .select('*')
    .eq('tracking_id', trackingId.toUpperCase().trim())
    .eq('site_id', site.id)
    .maybeSingle();

  if (!rawEvent) return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);
  const event = mapEvent(rawEvent);

  const { data: jaExiste } = await supabase.from('conversions').select('id').eq('event_id', event.id).maybeSingle();
  if (jaExiste) return c.json({ erro: 'Este ID já foi convertido anteriormente' }, 409);

  if (!site.fbPixelId || !site.fbAccessToken) {
    return c.json({ erro: 'Site sem Pixel ID ou Token da API configurados' }, 422);
  }

  const finalCurrency = currency || 'BRL';
  const finalValue = value ? parseFloat(value) : 0;

  const capiResult = await sendConversionEvent({
    pixelId: site.fbPixelId,
    accessToken: site.fbAccessToken,
    testEventCode: site.fbTestEventCode || null,
    trackingId: event.trackingId,
    pageUrl: event.pageUrl,
    fbclid: event.fbclid,
    eventCreatedAt: event.createdAt,
    ipOriginal: event.ipOriginal,
    userAgent: event.userAgent,
    eventName,
    value: finalValue,
    currency: finalCurrency,
  });

  const convId = randomUUID();
  await supabase.from('conversions').insert({
    id: convId,
    event_id: event.id,
    site_id: event.siteId,
    value: finalValue,
    currency: finalCurrency,
    fb_response: JSON.stringify(capiResult.response),
    fb_sent_at: new Date().toISOString(),
  });

  if (!capiResult.success) {
    return c.json({ erro: capiResult.error, detalhe: capiResult.response, convId }, 207);
  }

  return c.json({ sucesso: true, convId });
});

export default client;
