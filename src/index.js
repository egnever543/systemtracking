import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import apiRoutes from './routes/api.js';
import trackerRoutes from './routes/tracker.js';

const app = new Hono();

app.use('*', logger());

// Arquivos estáticos públicos
app.use('/tracker.js', serveStatic({ path: './public/tracker.js' }));
app.use('/assets/*', serveStatic({ root: './public' }));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Rastreamento público (chamado dos sites dos clientes)
app.route('/t', trackerRoutes);

// Auth
app.route('/', authRoutes);

// Redireciona raiz para dashboard
app.get('/', (c) => c.redirect('/dashboard'));

// Dashboard (protegido)
app.use('/dashboard/*', requireAuth);
app.route('/dashboard', dashboardRoutes);

// API interna (protegida)
app.use('/api/*', requireAuth);
app.route('/api', apiRoutes);

const port = parseInt(process.env.PORT || '3000');
console.log(`🚀 WA CAPI Tracker rodando na porta ${port}`);

serve({ fetch: app.fetch, port });
