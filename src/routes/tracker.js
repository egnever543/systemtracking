import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from '../db/index.js';
import { sites, events } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateTrackingId } from '../services/idGenerator.js';
import { randomUUID, createHash } from 'crypto';

const tracker = new Hono();

tracker.use('/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'] }));

tracker.post('/:siteId', async (c) => {
  const { siteId } = c.req.param();

  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!site) {
    return c.json({ erro: 'Site não encontrado' }, 404);
  }

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
    const [existe] = await db.select({ id: events.id }).from(events)
      .where(eq(events.trackingId, trackingId));
    if (!existe) break;
    tentativas++;
  } while (tentativas < 5);

  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId,
    siteId: site.id,
    trackingId,
    fbclid: fbclid || null,
    userAgent: user_agent || c.req.header('user-agent') || null,
    ipHash,
    ipOriginal,
    pageUrl: page_url || null,
  });

  return c.json({
    tracking_id: trackingId,
    phone: site.whatsappNumber,
    message: site.defaultMessage,
  });
});

export default tracker;
