import { Hono } from 'hono';
import { db } from '../db/index.js';
import { sites, events, conversions } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
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

// Dashboard principal
dash.get('/', (c) => {
  const user = c.get('user');
  const html = render('dashboard.html', {
    userName: user.name,
    subscriptionBanner: getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

// Lista de sites
dash.get('/sites', (c) => {
  const user = c.get('user');
  const userSites = db.select().from(sites).where(eq(sites.userId, user.userId))
    .orderBy(desc(sites.createdAt)).all();

  const siteCards = userSites.map((s) => {
    const cliques = db.get(sql`SELECT COUNT(*) as n FROM events WHERE site_id = ${s.id} AND created_at >= date('now','-30 days')`);
    const convs = db.get(sql`SELECT COUNT(*) as n FROM conversions WHERE site_id = ${s.id}`);
    return { ...s, cliques30d: cliques?.n || 0, totalConversoes: convs?.n || 0 };
  });

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const html = render('sites/list.html', {
    userName: user.name,
    sitesJSON: JSON.stringify(siteCards),
    baseUrl,
    subscriptionBanner: getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

// Formulário novo site
dash.get('/sites/novo', (c) => {
  const user = c.get('user');
  const html = render('sites/new.html', {
    userName: user.name,
    subscriptionBanner: getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

// Salva novo site
dash.post('/sites/novo', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();

  const { name, domain, whatsapp_number, default_message, fb_pixel_id, fb_access_token, fb_test_event_code } = body;

  if (!name || !domain || !whatsapp_number) {
    return c.redirect('/dashboard/sites/novo?erro=Preencha+os+campos+obrigatórios');
  }

  const id = randomUUID();
  db.insert(sites).values({
    id,
    userId: user.userId,
    name,
    domain,
    whatsappNumber: whatsapp_number,
    defaultMessage: default_message || 'Olá, vim pelo anúncio e quero saber mais!',
    fbPixelId: fb_pixel_id || null,
    fbAccessToken: fb_access_token || null,
    fbTestEventCode: fb_test_event_code || null,
  }).run();

  return c.redirect(`/dashboard/sites/${id}`);
});

// Detalhes do site
dash.get('/sites/:siteId', (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const site = db.select().from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.userId)))
    .get();

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
    subscriptionBanner: getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

// Edita site
dash.post('/sites/:siteId/editar', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const site = db.select({ id: sites.id }).from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.userId))).get();

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

  db.update(sites).set(updates).where(eq(sites.id, siteId)).run();
  return c.redirect(`/dashboard/sites/${siteId}?sucesso=1`);
});

// Página de registrar conversão
dash.get('/conversoes/registrar', (c) => {
  const user = c.get('user');
  const siteId = c.req.query('site') || '';
  const userSites = db.select({ id: sites.id, name: sites.name })
    .from(sites).where(eq(sites.userId, user.userId)).all();

  const html = render('conversions/register.html', {
    userName: user.name,
    sitesJSON: JSON.stringify(userSites),
    preselectedSite: siteId,
    subscriptionBanner: getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

export default dash;
