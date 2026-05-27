import { Hono } from 'hono';
import { db } from '../db/index.js';
import { sites, events, conversions } from '../db/schema.js';
import { eq, desc, and, count, gte } from 'drizzle-orm';
import { getSubscriptionBanner } from '../utils/subscription.js';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

function render(file, vars = {}) {
  let html = readFileSync(join(viewsDir, file), 'utf-8');
  for (const [key, val] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, String(val ?? ''));
  }
  return html;
}

const dash = new Hono();

dash.get('/', async (c) => {
  const user = c.get('user');
  const html = render('dashboard.html', {
    userName: user.name,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

dash.get('/sites', async (c) => {
  const user = c.get('user');
  const userSites = await db.select().from(sites).where(eq(sites.userId, user.userId))
    .orderBy(desc(sites.createdAt));

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const siteCards = await Promise.all(userSites.map(async (s) => {
    const [cliquesResult] = await db.select({ n: count() }).from(events)
      .where(and(eq(events.siteId, s.id), gte(events.createdAt, thirtyDaysAgo)));
    const [convsResult] = await db.select({ n: count() }).from(conversions)
      .where(eq(conversions.siteId, s.id));
    return { ...s, cliques30d: Number(cliquesResult?.n ?? 0), totalConversoes: Number(convsResult?.n ?? 0) };
  }));

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const html = render('sites/list.html', {
    userName: user.name,
    sitesJSON: JSON.stringify(siteCards),
    baseUrl,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

dash.get('/sites/novo', async (c) => {
  const user = c.get('user');
  const html = render('sites/new.html', {
    userName: user.name,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

dash.post('/sites/novo', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();

  const { name, domain, whatsapp_number, default_message, fb_pixel_id, fb_access_token, fb_test_event_code } = body;

  if (!name || !domain || !whatsapp_number) {
    return c.redirect('/dashboard/sites/novo?erro=Preencha+os+campos+obrigatórios');
  }

  const id = randomUUID();
  await db.insert(sites).values({
    id,
    userId: user.userId,
    name,
    domain,
    whatsappNumber: whatsapp_number,
    defaultMessage: default_message || 'Olá, vim pelo anúncio e quero saber mais!',
    fbPixelId: fb_pixel_id || null,
    fbAccessToken: fb_access_token || null,
    fbTestEventCode: fb_test_event_code || null,
  });

  return c.redirect(`/dashboard/sites/${id}`);
});

dash.get('/sites/:siteId', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const [site] = await db.select().from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.userId)));

  if (!site) return c.redirect('/dashboard/sites');

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const snippet = `&lt;script src="${baseUrl}/tracker.js" data-site="${site.id}" async&gt;&lt;/script&gt;`;

  const html = render('sites/detail.html', {
    userName: user.name,
    siteJSON: JSON.stringify({ ...site, fbAccessToken: '***' }),
    siteId: site.id,
    siteName: site.name,
    snippet,
    baseUrl,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

dash.post('/sites/:siteId/editar', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const [site] = await db.select({ id: sites.id }).from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.userId)));

  if (!site) return c.redirect('/dashboard/sites');

  const body = await c.req.parseBody();
  const updates = {
    name: body.name,
    domain: body.domain,
    whatsappNumber: body.whatsapp_number,
    defaultMessage: body.default_message,
    fbPixelId: body.fb_pixel_id || null,
    fbTestEventCode: body.fb_test_event_code || null,
  };
  if (body.fb_access_token && body.fb_access_token.trim()) {
    updates.fbAccessToken = body.fb_access_token.trim();
  }

  await db.update(sites).set(updates).where(eq(sites.id, siteId));
  return c.redirect(`/dashboard/sites/${siteId}?sucesso=1`);
});

dash.get('/conversoes/registrar', async (c) => {
  const user = c.get('user');
  const siteId = c.req.query('site') || '';
  const userSites = await db.select({ id: sites.id, name: sites.name })
    .from(sites).where(eq(sites.userId, user.userId));

  const html = render('conversions/register.html', {
    userName: user.name,
    sitesJSON: JSON.stringify(userSites),
    preselectedSite: siteId,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

export default dash;
