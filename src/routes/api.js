import { Hono } from 'hono';
import { db } from '../db/index.js';
import { sites, events, conversions } from '../db/schema.js';
import { eq, desc, and, gte, count, sql } from 'drizzle-orm';
import { sendPurchaseEvent } from '../services/facebookCapi.js';
import { randomUUID } from 'crypto';

const api = new Hono();

// Busca evento pelo tracking_id (usado no formulário de conversão)
api.get('/events/lookup/:trackingId', (c) => {
  const { trackingId } = c.req.param();
  const id = trackingId.toUpperCase().trim();

  const event = db
    .select({
      id: events.id,
      trackingId: events.trackingId,
      siteId: events.siteId,
      fbclid: events.fbclid,
      pageUrl: events.pageUrl,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.trackingId, id))
    .get();

  if (!event) {
    return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);
  }

  // Verifica se já tem conversão
  const conv = db
    .select({ id: conversions.id })
    .from(conversions)
    .where(eq(conversions.eventId, event.id))
    .get();

  const site = db.select({ name: sites.name }).from(sites).where(eq(sites.id, event.siteId)).get();

  return c.json({
    ...event,
    siteName: site?.name,
    jaConvertido: !!conv,
  });
});

// Registra conversão e envia para o Facebook CAPI
api.post('/conversions', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);

  if (!body) return c.json({ erro: 'Dados inválidos' }, 400);

  const { trackingId, value, currency } = body;

  if (!trackingId || !value) {
    return c.json({ erro: 'ID de rastreamento e valor são obrigatórios' }, 400);
  }

  const event = db
    .select()
    .from(events)
    .where(eq(events.trackingId, trackingId.toUpperCase().trim()))
    .get();

  if (!event) {
    return c.json({ erro: 'ID de rastreamento não encontrado' }, 404);
  }

  // Impede conversão duplicada
  const jaExiste = db
    .select({ id: conversions.id })
    .from(conversions)
    .where(eq(conversions.eventId, event.id))
    .get();

  if (jaExiste) {
    return c.json({ erro: 'Este ID já foi convertido anteriormente' }, 409);
  }

  const site = db.select().from(sites).where(eq(sites.id, event.siteId)).get();

  if (!site?.fbPixelId || !site?.fbAccessToken) {
    return c.json({ erro: 'Site sem Pixel ID ou Token da API configurados' }, 422);
  }

  // Envia para o Facebook CAPI
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
  db.insert(conversions).values({
    id: convId,
    eventId: event.id,
    siteId: event.siteId,
    value: parseFloat(value),
    currency: currency || 'BRL',
    registeredBy: user.userId,
    fbResponse: JSON.stringify(capiResult.response),
    fbSentAt: new Date().toISOString(),
  }).run();

  if (!capiResult.success) {
    return c.json(
      { erro: capiResult.error, detalhe: capiResult.response, convId },
      { status: 207 }
    );
  }

  return c.json({ sucesso: true, convId, fbResponse: capiResult.response });
});

// Métricas para o dashboard
api.get('/stats', (c) => {
  const user = c.get('user');

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const semana = new Date(hoje);
  semana.setDate(semana.getDate() - 7);
  const mes = new Date(hoje);
  mes.setDate(1);

  const userSites = db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.userId, user.userId))
    .all();

  const siteIds = userSites.map((s) => s.id);

  if (siteIds.length === 0) {
    return c.json({ cliquesHoje: 0, cliquesSemana: 0, cliquesMes: 0, totalConversoes: 0 });
  }

  // SQLite não tem operador IN com array pelo drizzle direto — usa raw
  const siteIdList = siteIds.map((id) => `'${id}'`).join(',');

  const cliquesHoje = db.get(sql`
    SELECT COUNT(*) as n FROM events
    WHERE site_id IN (${sql.raw(siteIdList)})
    AND created_at >= ${hoje.toISOString()}
  `);
  const cliquesSemana = db.get(sql`
    SELECT COUNT(*) as n FROM events
    WHERE site_id IN (${sql.raw(siteIdList)})
    AND created_at >= ${semana.toISOString()}
  `);
  const cliquesMes = db.get(sql`
    SELECT COUNT(*) as n FROM events
    WHERE site_id IN (${sql.raw(siteIdList)})
    AND created_at >= ${mes.toISOString()}
  `);
  const totalConversoes = db.get(sql`
    SELECT COUNT(*) as n FROM conversions
    WHERE site_id IN (${sql.raw(siteIdList)})
  `);

  return c.json({
    cliquesHoje: cliquesHoje?.n || 0,
    cliquesSemana: cliquesSemana?.n || 0,
    cliquesMes: cliquesMes?.n || 0,
    totalConversoes: totalConversoes?.n || 0,
  });
});

// Eventos recentes de um site
api.get('/sites/:siteId/events', (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();
  const limit = parseInt(c.req.query('limit') || '50');

  const site = db.select().from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.userId)))
    .get();

  if (!site) return c.json({ erro: 'Site não encontrado' }, 404);

  const rows = db
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
    .limit(limit)
    .all();

  const convSet = new Set(
    db.select({ eventId: conversions.eventId }).from(conversions)
      .where(eq(conversions.siteId, siteId)).all().map((r) => r.eventId)
  );

  return c.json(rows.map((e) => ({ ...e, convertido: convSet.has(e.id) })));
});

export default api;
