import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapSite } from '../db/mappers.js';
import { getSubscriptionBanner } from '../utils/subscription.js';
import { randomUUID } from 'crypto';
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
  const { data: rawSites } = await supabase.from('sites').select('*')
    .eq('user_id', user.userId).order('created_at', { ascending: false });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const siteCards = await Promise.all((rawSites || []).map(async (s) => {
    const site = mapSite(s);
    const { count: cliques30d } = await supabase.from('events')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .gte('created_at', thirtyDaysAgo);
    const { count: totalConversoes } = await supabase.from('conversions')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site.id);
    return { ...site, cliques30d: cliques30d || 0, totalConversoes: totalConversoes || 0 };
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
  await supabase.from('sites').insert({
    id,
    user_id: user.userId,
    name,
    domain,
    whatsapp_number,
    default_message: default_message || 'Olá, vim pelo anúncio e quero saber mais!',
    fb_pixel_id: fb_pixel_id || null,
    fb_access_token: fb_access_token || null,
    fb_test_event_code: fb_test_event_code || null,
  });

  return c.redirect(`/dashboard/sites/${id}`);
});

dash.get('/sites/:siteId', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const { data: raw } = await supabase.from('sites').select('*')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();

  const site = mapSite(raw);
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

  const { data: existing } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();

  if (!existing) return c.redirect('/dashboard/sites');

  const body = await c.req.parseBody();
  const updates = {
    name: body.name,
    domain: body.domain,
    whatsapp_number: body.whatsapp_number,
    default_message: body.default_message,
    fb_pixel_id: body.fb_pixel_id || null,
    fb_test_event_code: body.fb_test_event_code || null,
  };
  if (body.fb_access_token?.trim()) {
    updates.fb_access_token = body.fb_access_token.trim();
  }

  await supabase.from('sites').update(updates).eq('id', siteId);
  return c.redirect(`/dashboard/sites/${siteId}?sucesso=1`);
});

dash.get('/conversoes/registrar', async (c) => {
  const user = c.get('user');
  const siteId = c.req.query('site') || '';
  const { data: rawSites } = await supabase.from('sites').select('id, name').eq('user_id', user.userId);
  const userSites = (rawSites || []).map((s) => ({ id: s.id, name: s.name }));

  const html = render('conversions/register.html', {
    userName: user.name,
    sitesJSON: JSON.stringify(userSites),
    preselectedSite: siteId,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

export default dash;
