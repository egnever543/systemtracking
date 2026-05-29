import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapSite, mapEvent, mapSiteNumber } from '../db/mappers.js';
import { sendPurchaseEvent } from '../services/facebookCapi.js';
import { randomUUID, createHash, randomBytes } from 'crypto';

const api = new Hono();

api.get('/events/lookup/:trackingId', async (c) => {
  const { trackingId } = c.req.param();
  const id = trackingId.toUpperCase().trim();

  const { data: raw } = await supabase.from('events')
    .select('id, tracking_id, site_id, fbclid, page_url, created_at')
    .eq('tracking_id', id)
    .maybeSingle();

  const event = mapEvent(raw);
  if (!event) return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);

  const { data: conv } = await supabase.from('conversions').select('id').eq('event_id', event.id).maybeSingle();
  const { data: site } = await supabase.from('sites').select('name').eq('id', event.siteId).maybeSingle();

  return c.json({
    ...event,
    siteName: site?.name,
    jaConvertido: !!conv,
  });
});

api.post('/conversions', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) return c.json({ erro: 'Dados inválidos' }, 400);

  const { trackingId, value, currency } = body;

  if (!trackingId || !value) {
    return c.json({ erro: 'ID de rastreamento e valor são obrigatórios' }, 400);
  }

  const { data: rawEvent } = await supabase.from('events')
    .select('*')
    .eq('tracking_id', trackingId.toUpperCase().trim())
    .maybeSingle();

  const event = mapEvent(rawEvent);
  if (!event) return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);

  const { data: jaExiste } = await supabase.from('conversions').select('id').eq('event_id', event.id).maybeSingle();
  if (jaExiste) return c.json({ erro: 'Este ID já foi convertido anteriormente' }, 409);

  const { data: rawSite } = await supabase.from('sites').select('*').eq('id', event.siteId).maybeSingle();
  const site = mapSite(rawSite);

  if (!site?.fbPixelId || !site?.fbAccessToken) {
    return c.json({ erro: 'Site sem Pixel ID ou Token da API configurados' }, 422);
  }

  const capiResult = await sendPurchaseEvent({
    pixelId: site.fbPixelId,
    accessToken: site.fbAccessToken,
    testEventCode: site.fbTestEventCode || null,
    trackingId: event.trackingId,
    pageUrl: event.pageUrl,
    fbclid: event.fbclid,
    eventCreatedAt: event.createdAt,
    ipOriginal: event.ipOriginal,
    userAgent: event.userAgent,
    value: parseFloat(value),
    currency: currency || 'BRL',
  });

  const convId = randomUUID();
  await supabase.from('conversions').insert({
    id: convId,
    event_id: event.id,
    site_id: event.siteId,
    value: parseFloat(value),
    currency: currency || 'BRL',
    registered_by: user.userId,
    fb_response: JSON.stringify(capiResult.response),
    fb_sent_at: new Date().toISOString(),
  });

  if (!capiResult.success) {
    return c.json({ erro: capiResult.error, detalhe: capiResult.response, convId }, { status: 207 });
  }

  return c.json({ sucesso: true, convId, fbResponse: capiResult.response });
});

api.get('/stats', async (c) => {
  const user = c.get('user');

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const semana = new Date(hoje);
  semana.setDate(semana.getDate() - 7);
  const mes = new Date(hoje);
  mes.setDate(1);

  const { data: userSites } = await supabase.from('sites').select('id').eq('user_id', user.userId);
  const siteIds = (userSites || []).map((s) => s.id);

  if (siteIds.length === 0) {
    return c.json({ cliquesHoje: 0, cliquesSemana: 0, cliquesMes: 0, totalConversoes: 0 });
  }

  const { count: cliquesHoje } = await supabase.from('events')
    .select('*', { count: 'exact', head: true })
    .in('site_id', siteIds)
    .gte('created_at', hoje.toISOString());

  const { count: cliquesSemana } = await supabase.from('events')
    .select('*', { count: 'exact', head: true })
    .in('site_id', siteIds)
    .gte('created_at', semana.toISOString());

  const { count: cliquesMes } = await supabase.from('events')
    .select('*', { count: 'exact', head: true })
    .in('site_id', siteIds)
    .gte('created_at', mes.toISOString());

  const { count: totalConversoes } = await supabase.from('conversions')
    .select('*', { count: 'exact', head: true })
    .in('site_id', siteIds);

  const { count: totalCliques } = await supabase.from('events')
    .select('*', { count: 'exact', head: true })
    .in('site_id', siteIds);

  const total = totalCliques || 0;
  const taxaConversao = total > 0 ? Math.round(((totalConversoes || 0) / total) * 100) : 0;

  return c.json({
    cliquesHoje: cliquesHoje || 0,
    cliquesSemana: cliquesSemana || 0,
    cliquesMes: cliquesMes || 0,
    totalConversoes: totalConversoes || 0,
    totalCliques: total,
    taxaConversao,
  });
});

api.get('/sites/:siteId/events', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();
  const limit = parseInt(c.req.query('limit') || '50');

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();

  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  const days = c.req.query('days') ? Math.max(1, parseInt(c.req.query('days'))) : null;

  let eventsQuery = supabase.from('events')
    .select('id, tracking_id, fbclid, page_url, click_params, selected_number, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false });

  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    eventsQuery = eventsQuery.gte('created_at', since.toISOString());
  }

  const { data: rows } = await eventsQuery.limit(limit);

  const { data: convRows } = await supabase.from('conversions').select('event_id').eq('site_id', siteId);
  const convSet = new Set((convRows || []).map((r) => r.event_id));

  return c.json((rows || []).map((e) => ({
    id: e.id,
    trackingId: e.tracking_id,
    fbclid: e.fbclid,
    pageUrl: e.page_url,
    clickParams: e.click_params ?? null,
    selectedNumber: e.selected_number ?? null,
    createdAt: e.created_at,
    convertido: convSet.has(e.id),
  })));
});

api.get('/sites/:siteId/numbers', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  const { data: rows } = await supabase.from('site_numbers')
    .select('*').eq('site_id', siteId).order('created_at');

  return c.json((rows || []).map(mapSiteNumber));
});

api.post('/sites/:siteId/numbers', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body?.number) return c.json({ erro: 'Número obrigatório' }, 400);

  const { data, error } = await supabase.from('site_numbers').insert({
    id: randomUUID(),
    site_id: siteId,
    number: String(body.number).replace(/\D/g, ''),
    label: body.label || null,
    weight: Math.max(1, parseInt(body.weight) || 50),
  }).select().maybeSingle();

  if (error) return c.json({ erro: error.message }, 500);
  return c.json(mapSiteNumber(data));
});

api.delete('/sites/:siteId/numbers/:numberId', async (c) => {
  const user = c.get('user');
  const { siteId, numberId } = c.req.param();

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  await supabase.from('site_numbers').delete().eq('id', numberId).eq('site_id', siteId);
  return c.json({ ok: true });
});

api.get('/sites/:siteId/chart', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();
  const days = Math.min(90, Math.max(7, parseInt(c.req.query('days') || '30')));

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

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
    const { data: convs } = await supabase.from('conversions')
      .select('event_id').in('event_id', eventIds);
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

api.get('/sites/:siteId/numbers-stats', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  const [{ data: events }, { data: convs }] = await Promise.all([
    supabase.from('events').select('id, selected_number').eq('site_id', siteId),
    supabase.from('conversions').select('event_id').eq('site_id', siteId),
  ]);

  const convSet = new Set((convs || []).map(cv => cv.event_id));
  const stats = {};
  for (const ev of (events || [])) {
    const num = ev.selected_number || '(padrão)';
    if (!stats[num]) stats[num] = { number: num, cliques: 0, conversoes: 0 };
    stats[num].cliques++;
    if (convSet.has(ev.id)) stats[num].conversoes++;
  }

  return c.json(Object.values(stats).map(s => ({
    ...s,
    taxa: s.cliques > 0 ? Math.round((s.conversoes / s.cliques) * 100) : 0,
  })).sort((a, b) => b.cliques - a.cliques));
});

api.get('/keys', async (c) => {
  const user = c.get('user');
  const { data: rows } = await supabase.from('api_keys')
    .select('id, label, last_used_at, created_at')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false });
  return c.json(rows || []);
});

api.post('/keys', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const label = body?.label?.trim() || 'Chave sem nome';

  const rawKey = 'wact_' + randomBytes(20).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const id = randomUUID();

  const { error } = await supabase.from('api_keys').insert({
    id,
    user_id: user.userId,
    key_hash: keyHash,
    label,
  });

  if (error) return c.json({ erro: error.message }, 500);
  return c.json({ id, label, key: rawKey, createdAt: new Date().toISOString() }, 201);
});

api.delete('/keys/:keyId', async (c) => {
  const user = c.get('user');
  const { keyId } = c.req.param();

  const { data: row } = await supabase.from('api_keys')
    .select('id').eq('id', keyId).eq('user_id', user.userId).maybeSingle();

  if (!row) return c.json({ erro: 'Chave não encontrada' }, 404);

  await supabase.from('api_keys').delete().eq('id', keyId);
  return c.json({ ok: true });
});

export default api;
