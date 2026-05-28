import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { supabase } from '../db/index.js';
import { mapSite, mapSiteNumber } from '../db/mappers.js';
import { generateTrackingId } from '../services/idGenerator.js';
import { randomUUID, createHash } from 'crypto';

const tracker = new Hono();

tracker.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

const TRACKING_RE = /^WA-[A-Z2-9]{6}$/;

function selectByWeight(numbers) {
  const total = numbers.reduce((sum, n) => sum + n.weight, 0);
  let rand = Math.random() * total;
  for (const n of numbers) {
    rand -= n.weight;
    if (rand <= 0) return n;
  }
  return numbers[numbers.length - 1];
}

tracker.get('/r/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const [{ data: raw }, { data: numbersRaw }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', siteId).maybeSingle(),
    supabase.from('site_numbers').select('*').eq('site_id', siteId).order('created_at'),
  ]);

  const site = mapSite(raw);
  if (!site) return c.redirect('https://wa.me/');

  const numbers = (numbersRaw || []).map(mapSiteNumber).filter(Boolean);
  const selected = numbers.length > 0
    ? selectByWeight(numbers)
    : { number: site.whatsappNumber, label: null };

  const query = c.req.query();
  const clickParams = Object.fromEntries(Object.entries(query).filter(([, v]) => v));

  const ipOriginal =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'desconhecido';
  const ipHash = createHash('sha256').update(ipOriginal).digest('hex').slice(0, 16);

  const trackingId = generateTrackingId();

  await supabase.from('events').insert({
    id: randomUUID(),
    site_id: site.id,
    tracking_id: trackingId,
    fbclid: query.fbclid || null,
    user_agent: c.req.header('user-agent') || null,
    ip_hash: ipHash,
    ip_original: ipOriginal,
    page_url: c.req.header('referer') || null,
    click_params: Object.keys(clickParams).length > 0 ? clickParams : null,
    selected_number: selected.number,
  });

  const msg = (site.defaultMessage || '') + ' [' + trackingId + ']';
  return c.redirect('https://wa.me/' + selected.number + '?text=' + encodeURIComponent(msg), 302);
});

tracker.get('/:siteId/config', async (c) => {
  const { siteId } = c.req.param();
  const { data: raw } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
  const site = mapSite(raw);
  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  return c.json({ phone: site.whatsappNumber, message: site.defaultMessage });
});

tracker.post('/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const { data: raw } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
  const site = mapSite(raw);
  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const { fbclid, page_url, user_agent, tracking_id: clientTrackingId } = body;

  const ipOriginal =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'desconhecido';

  const ipHash = createHash('sha256').update(ipOriginal).digest('hex').slice(0, 16);

  let trackingId;
  if (clientTrackingId && TRACKING_RE.test(clientTrackingId)) {
    trackingId = clientTrackingId;
  } else {
    let tentativas = 0;
    do {
      trackingId = generateTrackingId();
      const { data: existe } = await supabase.from('events').select('id').eq('tracking_id', trackingId).maybeSingle();
      if (!existe) break;
      tentativas++;
    } while (tentativas < 5);
  }

  await supabase.from('events').insert({
    id: randomUUID(),
    site_id: site.id,
    tracking_id: trackingId,
    fbclid: fbclid || null,
    user_agent: user_agent || c.req.header('user-agent') || null,
    ip_hash: ipHash,
    ip_original: ipOriginal,
    page_url: page_url || null,
  });

  return c.json({
    tracking_id: trackingId,
    phone: site.whatsappNumber,
    message: site.defaultMessage,
  });
});

export default tracker;
