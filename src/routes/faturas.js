import { Hono } from 'hono';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const FASTDEPIX_BASE = 'https://fastdepix.space/api/v1';

function getToken() {
  return process.env.FASTDEPIX_API_KEY || '';
}

async function fdpxRequest(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${FASTDEPIX_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json();
}

const faturas = new Hono();

// GET /faturas — lista faturas recentes
faturas.get('/', async (c) => {
  const result = await fdpxRequest('/transactions?limit=20').catch(() => null);
  const transactions = result?.data?.transactions ?? [];

  let html = readFileSync(join(viewsDir, 'faturas.html'), 'utf-8');
  html = html.replaceAll('{{transactionsJson}}', JSON.stringify(transactions));
  return c.html(html);
});

// POST /faturas/criar — cria nova fatura via FastDePix
faturas.post('/criar', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { amount, name, cpf_cnpj } = body;

  if (!amount || isNaN(Number(amount)) || Number(amount) < 10) {
    return c.json({ success: false, message: 'Valor mínimo de R$ 10,00' }, 400);
  }

  const payload = { amount: Number(amount) };

  if (Number(amount) >= 500 || (name && cpf_cnpj)) {
    if (name && cpf_cnpj) {
      payload.user = { name, cpf_cnpj, user_type: 'individual' };
    }
  }

  const result = await fdpxRequest('/transactions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return c.json(result, result.success ? 201 : 400);
});

// GET /faturas/status/:id — consulta status de uma fatura
faturas.get('/status/:id', async (c) => {
  const id = c.req.param('id');
  const result = await fdpxRequest(`/transactions/${id}`);
  return c.json(result);
});

export default faturas;
