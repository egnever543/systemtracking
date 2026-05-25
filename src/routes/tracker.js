import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from '../db/index.js';
import { sites, events } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateTrackingId } from '../services/idGenerator.js';
import { randomUUID, createHash } from 'crypto';

const tracker = new Hono();

// CORS liberado — será chamado de domínios externos dos clientes
tracker.use('/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'] }));

tracker.post('/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const site = db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site) {
    return c.json({ erro: 'Site não encontrado' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const { fbclid, page_url, user_agent } = body;

  // Extrai IP real (considera proxies como Caddy/Nginx)
  const ipOriginal =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    'desconhecido';

  // Hash do IP para privacidade nos logs da UI
  const ipHash = createHash('sha256').update(ipOriginal).digest('hex').slice(0, 16);

  // Gera tracking_id único — tenta até não colidir (extremamente raro)
  let trackingId;
  let tentativas = 0;
  do {
    trackingId = generateTrackingId();
    const existe = db.select({ id: events.id }).from(events)
      .where(eq(events.trackingId, trackingId)).get();
    if (!existe) break;
    tentativas++;
  } while (tentativas < 5);

  const eventId = randomUUID();
  db.insert(events).values({
    id: eventId,
    siteId: site.id,
    trackingId,
    fbclid: fbclid || null,
    userAgent: user_agent || c.req.header('user-agent') || null,
    ipHash,
    ipOriginal,
    pageUrl: page_url || null,
  }).run();

  return c.json({
    tracking_id: trackingId,
    phone: site.whatsappNumber,
    message: site.defaultMessage,
  });
});

export default tracker;
