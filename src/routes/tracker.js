import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { supabase } from '../db/index.js';
import { mapSite } from '../db/mappers.js';
import { generateTrackingId } from '../services/idGenerator.js';
import { randomUUID, createHash } from 'crypto';

const tracker = new Hono();

tracker.use('/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'] }));

tracker.post('/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const { data: raw } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
  const site = mapSite(raw);
  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const { fbclid, page_url, user_agent } = body;

  const ipOriginal =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'desconhecido';

  const ipHash = createHash('sha256').update(ipOriginal).digest('hex').slice(0, 16);

  let trackingId;
  let tentativas = 0;
  do {
    trackingId = generateTrackingId();
    const { data: existe } = await supabase.from('events').select('id').eq('tracking_id', trackingId).maybeSingle();
    if (!existe) break;
    tentativas++;
  } while (tentativas < 5);

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
