import { Hono } from 'hono';
import { supabase } from '../db/index.js';
import { mapSite } from '../db/mappers.js';
import { getSubscriptionBanner } from '../utils/subscription.js';
import { getUserUsage } from '../utils/planUsage.js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCookie } from 'hono/cookie';
import { getTranslations, detectLocale } from '../i18n/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

function render(file, vars = {}, locale = 'pt') {
  let html = readFileSync(join(viewsDir, file), 'utf-8');
  const t = getTranslations(locale);
  for (const [k, v] of Object.entries(t)) {
    html = html.replaceAll(`{{t_${k}}}`, v);
  }
  html = html.replaceAll('{{locale}}', locale);
  html = html.replaceAll('{{localToggleTarget}}', locale === 'en' ? 'pt' : 'en');
  for (const [key, val] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, String(val ?? ''));
  }
  return html;
}

const dash = new Hono();

dash.get('/', async (c) => {
  const user = c.get('user');
  const locale = detectLocale(c);
  const html = render('dashboard.html', {
    userName: user.name,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  }, locale);
  return c.html(html);
});

dash.get('/sites', async (c) => {
  const user = c.get('user');
  const locale = detectLocale(c);
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
  }, locale);
  return c.html(html);
});

dash.get('/sites/novo', async (c) => {
  const user = c.get('user');
  const locale = detectLocale(c);
  const html = render('sites/new.html', {
    userName: user.name,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  }, locale);
  return c.html(html);
});

dash.post('/sites/novo', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const { name, domain, whatsapp_number, default_message } = body;

  if (!name || !domain || !whatsapp_number) {
    return c.redirect('/dashboard/sites/novo?erro=Preencha+os+campos+obrigat%C3%B3rios');
  }

  const usage = await getUserUsage(user.userId);
  if (usage.siteLimitReached) {
    return c.redirect(`/dashboard/sites/novo?erro=${encodeURIComponent(`Limite de sites atingido para o plano ${usage.plan.name}. Faça upgrade para criar mais sites.`)}`);
  }

  const id = randomUUID();
  const { error } = await supabase.from('sites').insert({
    id,
    user_id: user.userId,
    name,
    domain,
    whatsapp_number,
    default_message: default_message || 'Olá, vim pelo anúncio e quero saber mais!',
    fb_pixel_id: body.fb_pixel_id || null,
    fb_access_token: body.fb_access_token || null,
    fb_test_event_code: body.fb_test_event_code || null,
    google_customer_id: body.google_customer_id || null,
    google_conversion_action_id: body.google_conversion_action_id || null,
    tiktok_pixel_id: body.tiktok_pixel_id || null,
    tiktok_access_token: body.tiktok_access_token || null,
  });

  if (error) {
    console.error('[criar-site]', error);
    return c.redirect(`/dashboard/sites/novo?erro=${encodeURIComponent('Erro ao criar site: ' + error.message)}`);
  }

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

  const locale = detectLocale(c);
  const html = render('sites/detail.html', {
    userName: user.name,
    siteJSON: JSON.stringify({
      ...site,
      fbAccessToken: '***',
      googleDeveloperToken: undefined,
      googleRefreshToken: undefined,
      googleConectado: !!site.googleRefreshToken,
    }),
    siteId: site.id,
    siteName: site.name,
    snippet,
    baseUrl,
    redirectUrl: `${baseUrl}/t/r/${site.id}`,
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  }, locale);
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
    google_customer_id: body.google_customer_id || null,
    google_conversion_action_id: body.google_conversion_action_id || null,
    tiktok_pixel_id: body.tiktok_pixel_id || null,
  };
  if (body.fb_access_token?.trim()) updates.fb_access_token = body.fb_access_token.trim();
  if (body.google_developer_token?.trim()) updates.google_developer_token = body.google_developer_token.trim();
  if (body.google_refresh_token?.trim()) updates.google_refresh_token = body.google_refresh_token.trim();
  if (body.tiktok_access_token?.trim()) updates.tiktok_access_token = body.tiktok_access_token.trim();

  await supabase.from('sites').update(updates).eq('id', siteId);
  return c.redirect(`/dashboard/sites/${siteId}?sucesso=1`);
});

dash.post('/sites/:siteId/deletar', async (c) => {
  const user = c.get('user');
  const { siteId } = c.req.param();

  const { data: existing } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!existing) return c.redirect('/dashboard/sites');

  await supabase.from('conversions').delete().eq('site_id', siteId);
  await supabase.from('events').delete().eq('site_id', siteId);
  await supabase.from('site_numbers').delete().eq('site_id', siteId);
  await supabase.from('sites').delete().eq('id', siteId);

  return c.redirect('/dashboard/sites?msg=Site+excluído+com+sucesso');
});

dash.get('/conversoes', async (c) => {
  const user = c.get('user');
  const html = render('conversions/list.html', {
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
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

dash.get('/docs', async (c) => {
  const user = c.get('user');
  const html = render('docs.html', {
    subscriptionBanner: await getSubscriptionBanner(user.userId),
  });
  return c.html(html);
});

dash.get('/google/connect', async (c) => {
  const user = c.get('user');
  const siteId = c.req.query('siteId');
  if (!siteId) return c.redirect('/dashboard/sites');

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.redirect('/dashboard/sites');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.html('<p style="font-family:sans-serif;padding:2rem">❌ <b>GOOGLE_CLIENT_ID</b> não configurado no servidor.</p>', 500);

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl}/dashboard/google/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    prompt: 'consent',
    state: siteId,
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

dash.get('/google/callback', async (c) => {
  const user = c.get('user');
  const { code, state: siteId, error } = c.req.query();

  if (error || !code || !siteId) {
    return c.redirect('/dashboard/sites?erro=Google+negou+o+acesso');
  }

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.redirect('/dashboard/sites');

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: `${baseUrl}/dashboard/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || !tokenData.refresh_token) {
    console.error('[google-oauth]', tokenData);
    return c.redirect(`/dashboard/sites/${siteId}?erro=google`);
  }

  await supabase.from('sites')
    .update({ google_refresh_token: tokenData.refresh_token })
    .eq('id', siteId);

  return c.redirect(`/dashboard/sites/${siteId}?google=conectado`);
});

dash.post('/google/disconnect', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const siteId = body.siteId;
  if (!siteId) return c.redirect('/dashboard/sites');

  const { data: rawSite } = await supabase.from('sites').select('id')
    .eq('id', siteId).eq('user_id', user.userId).maybeSingle();
  if (!rawSite) return c.redirect('/dashboard/sites');

  await supabase.from('sites').update({ google_refresh_token: null }).eq('id', siteId);
  return c.redirect(`/dashboard/sites/${siteId}`);
});

dash.get('/settings', async (c) => {
  const user = c.get('user');
  const { data: fullUser } = await supabase.from('users').select('logo_url').eq('id', user.userId).maybeSingle();
  const html = render('settings.html', {
    subscriptionBanner: await getSubscriptionBanner(user.userId),
    logoUrl: fullUser?.logo_url || '',
  });
  return c.html(html);
});

export default dash;
