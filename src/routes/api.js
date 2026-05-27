import { Hono } from 'hono';
import { db } from '../db/index.js';
import { sites, events, conversions } from '../db/schema.js';
import { eq, desc, and, gte, count, inArray } from 'drizzle-orm';
import { sendPurchaseEvent } from '../services/facebookCapi.js';
import { randomUUID } from 'crypto';

const api = new Hono();

api.get('/events/lookup/:trackingId', async (c) => {
  const { trackingId } = c.req.param();
  const id = trackingId.toUpperCase().trim();

  const [event] = await db
    .select({
      id: events.id,
      trackingId: events.trackingId,
      siteId: events.siteId,
      fbclid: events.fbclid,
      pageUrl: events.pageUrl,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.trackingId, id));

  if (!event) {
    return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);
  }

  const [conv] = await db
    .select({ id: conversions.id })
    .from(conversions)
    .where(eq(conversions.eventId, event.id));

  const [site] = await db.select({ name: sites.name }).from(sites).where(eq(sites.id, event.siteId));

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

  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.trackingId, trackingId.toUpperCase().trim()));

  if (!event) {
    return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);
  }

  const [jaExiste] = await db
    .select({ id: conversions.id })
    .from(conversions)
    .where(eq(conversions.eventId, event.id));

  if (jaExiste) {
    return c.json({ erro: 'Este ID já foi convertido anteriormente' }, 409);
  }

  const [site] = await db.select().from(sites).where(eq(sites.id, event.siteId));

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
  await db.insert(conversions).values({
    id: convId,
    eventId: event.id,
    siteId: event.siteId,
    value: parseFloat(value),
    currency: currency || 'BRL',
    registeredBy: user.userId,
    fbResponse: JSON.stringify(capiResult.response),
    fbSentAt: new Date().toISOString(),
  });

  if (!capiResult.success) {
    return c.json(
      { erro: capiResult.error, detalhe: capiResult.response, convId },
      { status: 207 }
    );
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

  const userSites = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.userId, user.userId));

  const siteIds = userSites.map((s) => s.id);

  if (siteIds.length === 0) {
    return c.json({ cliquesHoje: 0, cliquesSemana: 0, cliquesMes: 0, totalConversoes: 0 });
  }

  const [cliquesHoje] = await db.select({ n: count() }).from(events)
    .where(and(inArray(events.siteId, siteIds), gte(events.createdAt, hoje.toISOString())));

  const [cliquesSemana] = await db.select({ n: count() }).from(events)
    .where(and(inArray(events.siteId, siteIds), gte(events.createdAt, semana.toISOString())));

  const [cliquesMes] = await db.select({ n: count() }).from(events)
    .where(and(inArray(events.siteId, siteIds), gte(events.createdAt, mes.toISOString())));

  const [totalConversoes] = await db.select({ n: count() }).from(conversions)
    .where(inArray(conversions.siteId, siteIds));

  return c.json({
    cliquesHoje: Number(cliquesHoje?.n ?? 0),
    cliquesSemana: Number(cliquesSemana?.n ?? 0),
    cliquesMes: Number(cliquesMes?.n ?? 0),
    totalConversoes: Number(totalConversoes?.n ?? 0),
  });
});

api.get('/sites/:siteId/events', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();
  const limit = parseInt(c.req.query('limit') || '50');

  const [site] = await db.select().from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.userId)));

  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  const rows = await db
    .select({
      id: events.id,
      trackingId: events.trackingId,
      fbclid: events.fbclid,
      pageUrl: events.pageUrl,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.siteId, siteId))
    .orderBy(desc(events.createdAt))
    .limit(limit);

  const convRows = await db.select({ eventId: conversions.eventId }).from(conversions)
    .where(eq(conversions.siteId, siteId));
  const convSet = new Set(convRows.map((r) => r.eventId));

  return c.json(rows.map((e) => ({ ...e, convertido: convSet.has(e.id) })));
});

export default api;
