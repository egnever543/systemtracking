import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapSite, mapEvent, mapSiteNumber } from '../db/mappers.js';
import { sendPurchaseEvent, sendConversionEvent } from '../services/facebookCapi.js';
import { sendGoogleConversion } from '../services/googleAdsCapi.js';
import { sendTiktokConversion } from '../services/tiktokCapi.js';
import { sendEmail, conversionEmailHtml } from '../services/email.js';
import { randomUUID, createHash, randomBytes } from 'crypto';

const api = new Hono();

api.get('/conversions', async (c) => {
  const user = c.get('user');
  const limit = Math.min(100, Math.max(5, parseInt(c.req.query('limit') || '25')));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));
  const filterSite = c.req.query('siteId') || null;
  const days = c.req.query('days') ? parseInt(c.req.query('days')) : null;

  const { data: userSites } = await supabase.from('sites').select('id, name').eq('user_id', user.userId);
  const siteIds = (userSites || []).map(s => s.id);
  const siteNames = Object.fromEntries((userSites || []).map(s => [s.id, s.name]));
  if (siteIds.length === 0) return c.json({ items: [], total: 0, sites: [] });

  const targetIds = filterSite && siteIds.includes(filterSite) ? [filterSite] : siteIds;

  // Resolve via events table — avoids dependência de site_id na tabela conversions
  const { data: siteEvents, error: evErr } = await supabase
    .from('events')
    .select('id, site_id')
    .in('site_id', targetIds);

  if (evErr) {
    console.error('[GET /api/conversions] events query error:', evErr);
    return c.json({ items: [], total: 0, sites: (userSites || []).map(s => ({ id: s.id, name: s.name })) });
  }

  const allEventIds = (siteEvents || []).map(e => e.id);
  const eventSiteMap = Object.fromEntries((siteEvents || []).map(e => [e.id, e.site_id]));

  if (allEventIds.length === 0) {
    return c.json({ items: [], total: 0, sites: (userSites || []).map(s => ({ id: s.id, name: s.name })) });
  }

  let countQ = supabase.from('conversions')
    .select('*', { count: 'exact', head: true })
    .in('event_id', allEventIds);
  let dataQ = supabase.from('conversions')
    .select('id, event_id, value, currency, fb_sent_at, created_at')
    .in('event_id', allEventIds)
    .order('created_at', { ascending: false });

  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString();
    countQ = countQ.gte('created_at', sinceStr);
    dataQ = dataQ.gte('created_at', sinceStr);
  }

  const [countResult, dataResult] = await Promise.all([
    countQ,
    dataQ.range(offset, offset + limit - 1),
  ]);

  if (countResult.error || dataResult.error) {
    console.error('[GET /api/conversions] conversions query error:', countResult.error || dataResult.error);
    return c.json({ items: [], total: 0, sites: (userSites || []).map(s => ({ id: s.id, name: s.name })) });
  }

  const { count: total } = countResult;
  const { data: rows } = dataResult;

  const convEventIds = (rows || []).map(r => r.event_id).filter(Boolean);
  let evDetailMap = {};
  if (convEventIds.length > 0) {
    const { data: evRows } = await supabase.from('events')
      .select('id, site_id, tracking_id, fbclid, click_params, page_url, selected_number, created_at')
      .in('id', convEventIds);
    for (const ev of (evRows || [])) evDetailMap[ev.id] = ev;
  }

  return c.json({
    sites: (userSites || []).map(s => ({ id: s.id, name: s.name })),
    total: total || 0,
    items: (rows || []).map(r => {
      const ev = evDetailMap[r.event_id] || {};
      const siteId = ev.site_id || eventSiteMap[r.event_id] || null;
      return {
        id: r.id,
        siteId,
        siteName: siteNames[siteId] || '—',
        value: r.value,
        currency: r.currency,
        fbSentAt: r.fb_sent_at,
        createdAt: r.created_at,
        trackingId: ev.tracking_id || null,
        fbclid: ev.fbclid || null,
        gclid: ev.click_params?.gclid || null,
        utmSource: ev.click_params?.utm_source || null,
        pageUrl: ev.page_url || null,
        selectedNumber: ev.selected_number || null,
        clickAt: ev.created_at || null,
      };
    }),
  });
});

api.get('/events/lookup/:trackingId', async (c) => {
  const { trackingId } = c.req.param();
  const id = trackingId.toUpperCase().trim();

  const { data: raw } = await supabase.from('events')
    .select('id, tracking_id, site_id, fbclid, page_url, click_params, created_at')
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

const VALID_EVENTS = ['Purchase', 'Lead', 'InitiateCheckout', 'AddToCart', 'ViewContent'];

api.post('/conversions', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) return c.json({ erro: 'Dados inválidos' }, 400);

  const { trackingId, value, currency, eventName = 'Purchase' } = body;

  if (!trackingId) return c.json({ erro: 'ID de rastreamento é obrigatório' }, 400);
  if (!VALID_EVENTS.includes(eventName)) return c.json({ erro: 'Tipo de evento inválido' }, 400);
  if (eventName === 'Purchase' && !value) return c.json({ erro: 'Valor é obrigatório para Venda' }, 400);

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

  const gclid = rawEvent?.click_params?.gclid || null;
  const enviarFacebook = !!event.fbclid;
  const enviarGoogle = !!gclid;

  if (enviarFacebook && (!site?.fbPixelId || !site?.fbAccessToken)) {
    return c.json({ erro: 'Site sem Pixel ID ou Token da API configurados' }, 422);
  }

  const finalCurrency = currency || 'BRL';
  const finalValue = value ? parseFloat(value) : 0;

  let capiResult = { success: true, response: {}, skipped: true };
  if (enviarFacebook) {
    capiResult = await sendConversionEvent({
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
  }

  // Google Ads + TikTok: somente para Purchase e se veio do Google, fire-and-forget
  if (eventName === 'Purchase' && enviarGoogle) {
    Promise.all([
      sendGoogleConversion({
        customerId: site.googleCustomerId,
        conversionActionId: site.googleConversionActionId,
        developerToken: process.env.GOOGLE_DEVELOPER_TOKEN || site.googleDeveloperToken,
        refreshToken: site.googleRefreshToken,
        gclid,
        conversionDateTime: event.createdAt,
        value: finalValue,
        currency: finalCurrency,
      }),
      sendTiktokConversion({
        pixelId: site.tiktokPixelId,
        accessToken: site.tiktokAccessToken,
        trackingId: event.trackingId,
        pageUrl: event.pageUrl,
        value: finalValue,
        currency: finalCurrency,
      }),
    ]).then(([gRes, ttRes]) => {
      if (!gRes.skipped && !gRes.success) console.error('[google-capi]', gRes.error);
      if (!ttRes.skipped && !ttRes.success) console.error('[tiktok-capi]', ttRes.error);
    }).catch(() => {});
  }

  const convId = randomUUID();
  await supabase.from('conversions').insert({
    id: convId,
    event_id: event.id,
    site_id: event.siteId,
    value: finalValue,
    currency: finalCurrency,
    registered_by: user.userId,
    fb_response: capiResult.skipped ? null : JSON.stringify(capiResult.response),
    fb_sent_at: capiResult.skipped ? null : new Date().toISOString(),
  });

  // Email de notificação somente para Purchase
  if (eventName === 'Purchase') {
    supabase.from('users').select('email, name').eq('id', rawSite.user_id).maybeSingle()
      .then(({ data: owner }) => {
        if (owner) {
          return sendEmail({
            to: owner.email,
            subject: `💰 Nova venda — ${event.trackingId}`,
            html: conversionEmailHtml({
              siteName: site.name,
              trackingId: event.trackingId,
              value: finalValue,
              currency: finalCurrency,
            }),
          });
        }
      }).catch(() => {});
  }

  if (!capiResult.skipped && !capiResult.success) {
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
    totalSites: siteIds.length,
  });
});

api.get('/sites/:siteId/events', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();
  const limit = Math.min(100, Math.max(5, parseInt(c.req.query('limit') || '25')));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  let sinceStr = null;
  if (c.req.query('days')) {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, parseInt(c.req.query('days'))));
    sinceStr = since.toISOString();
  }

  let countQ = supabase.from('events').select('*', { count: 'exact', head: true }).eq('site_id', siteId);
  let dataQ = supabase.from('events')
    .select('id, tracking_id, fbclid, page_url, click_params, selected_number, created_at')
    .eq('site_id', siteId).order('created_at', { ascending: false });
  if (sinceStr) { countQ = countQ.gte('created_at', sinceStr); dataQ = dataQ.gte('created_at', sinceStr); }

  const [{ count: total }, { data: rows }] = await Promise.all([
    countQ,
    dataQ.range(offset, offset + limit - 1),
  ]);

  const { data: convRows } = await supabase.from('conversions').select('event_id').eq('site_id', siteId);
  const convSet = new Set((convRows || []).map((r) => r.event_id));

  return c.json({
    items: (rows || []).map((e) => ({
      id: e.id,
      trackingId: e.tracking_id,
      fbclid: e.fbclid,
      pageUrl: e.page_url,
      clickParams: e.click_params ?? null,
      selectedNumber: e.selected_number ?? null,
      createdAt: e.created_at,
      convertido: convSet.has(e.id),
    })),
    total: total || 0,
  });
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

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

api.post('/profile/logo', async (c) => {
  const user = c.get('user');

  let formData;
  try { formData = await c.req.formData(); } catch {
    return c.json({ erro: 'Requisição inválida' }, 400);
  }

  const file = formData.get('logo');
  if (!file || typeof file === 'string') return c.json({ erro: 'Arquivo não enviado' }, 400);
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return c.json({ erro: 'Use JPG, PNG ou WebP (máx 2 MB)' }, 400);
  if (file.size > 2 * 1024 * 1024) return c.json({ erro: 'Imagem deve ter no máximo 2 MB' }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = user.userId;

  // Cria o bucket na primeira vez se não existir
  const { error: bucketErr } = await supabase.storage.getBucket('logos');
  if (bucketErr) {
    await supabase.storage.createBucket('logos', { public: true });
  }

  const { error: upErr } = await supabase.storage.from('logos').upload(fileName, buffer, {
    contentType: file.type,
    upsert: true,
  });
  if (upErr) return c.json({ erro: `Erro no upload: ${upErr.message}` }, 500);

  const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName);

  await supabase.from('users').update({ logo_url: publicUrl }).eq('id', user.userId);
  return c.json({ logoUrl: publicUrl });
});

api.delete('/profile/logo', async (c) => {
  const user = c.get('user');
  await supabase.storage.from('logos').remove([user.userId]);
  await supabase.from('users').update({ logo_url: null }).eq('id', user.userId);
  return c.json({ ok: true });
});

api.post('/sites/:siteId/client-token', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  const token = randomBytes(18).toString('base64url');
  const { error } = await supabase.from('sites')
    .update({ client_token: token, client_access_enabled: true })
    .eq('id', siteId);

  if (error) return c.json({ erro: error.message }, 500);
  return c.json({ token, clientAccessEnabled: true });
});

api.patch('/sites/:siteId/client-access', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();
  const body = await c.req.json().catch(() => null);

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.json({ erro: 'Site não encontrado' }, 404);

  const enabled = !!body?.enabled;
  const { error } = await supabase.from('sites')
    .update({ client_access_enabled: enabled })
    .eq('id', siteId);

  if (error) return c.json({ erro: error.message }, 500);
  return c.json({ clientAccessEnabled: enabled });
});

export default api;
