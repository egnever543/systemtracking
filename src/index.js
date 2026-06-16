import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { readFileSync } from 'fs';
import { join } from 'path';
import cron from 'node-cron';
import { requireAuth, requireAuthApi } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import apiRoutes from './routes/api.js';
import trackerRoutes from './routes/tracker.js';
import billingRoutes, { webhookHandler, stripeWebhookHandler } from './routes/billing.js';
import clientRoutes from './routes/client.js';
import { sendWeeklyReports } from './services/weeklyReport.js';
import { processLostLeads } from './services/lostLeads.js';
import { processDataRetention } from './services/dataRetention.js';

const app = new Hono();

app.use('*', logger());

// Arquivos estáticos públicos
app.use('/tracker.js', serveStatic({ path: './public/tracker.js' }));
app.use('/assets/*', serveStatic({ root: './public' }));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Rastreamento público (chamado dos sites dos clientes)
app.route('/t', trackerRoutes);
app.get('/r/:siteId', (c) => {
  const { siteId } = c.req.param();
  const qs = new URLSearchParams(Object.entries(c.req.query())).toString();
  return c.redirect('/t/r/' + siteId + (qs ? '?' + qs : ''), 302);
});

// Landing page — detecta idioma via cookie ou Accept-Language
app.get('/', (c) => {
  const cookieHeader = c.req.header('cookie') || '';
  const localeCookie = cookieHeader.match(/(?:^|;\s*)locale=([^;]+)/)?.[1];
  const al = c.req.header('accept-language') || '';
  const locale = (localeCookie === 'en' || localeCookie === 'pt')
    ? localeCookie
    : (al.toLowerCase().startsWith('en') ? 'en' : 'pt');
  const file = locale === 'en' ? 'views/landing-en.html' : 'views/landing.html';
  try {
    const html = readFileSync(join(process.cwd(), file), 'utf-8');
    return c.html(html);
  } catch {
    const html = readFileSync(join(process.cwd(), 'views/landing.html'), 'utf-8');
    return c.html(html);
  }
});

app.get('/en', (c) => {
  try {
    const html = readFileSync(join(process.cwd(), 'views/landing-en.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.redirect('/');
  }
});

app.get('/pt', (c) => {
  const html = readFileSync(join(process.cwd(), 'views/landing.html'), 'utf-8');
  return c.html(html);
});

// Auth
app.route('/', authRoutes);

// Dashboard (protegido)
app.use('/dashboard/*', requireAuth);
app.route('/dashboard', dashboardRoutes);

// API interna (protegida)
app.use('/api/*', requireAuthApi);
app.route('/api', apiRoutes);

// Portal do cliente (sem auth — token na URL valida acesso)
app.route('/cliente', clientRoutes);

// Webhooks públicos (sem auth)
app.post('/webhook/mp', webhookHandler);
app.post('/webhook/stripe', stripeWebhookHandler);

// Billing (protegido)
app.use('/billing/*', requireAuth);
app.route('/billing', billingRoutes);

const port = parseInt(process.env.PORT || '3000');
console.log(`🚀 MeuFluxo rodando na porta ${port}`);

serve({ fetch: app.fetch, port });

// Relatório semanal — toda segunda-feira às 8h (horário de Brasília = 11h UTC)
cron.schedule('0 11 * * 1', sendWeeklyReports);
cron.schedule('0 */2 * * *', processLostLeads);
cron.schedule('0 3 * * *', processDataRetention);
