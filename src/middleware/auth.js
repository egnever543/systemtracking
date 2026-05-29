import { getCookie } from 'hono/cookie';
import { createHash } from 'crypto';
import { supabase } from '../db/index.js';

/**
 * Protege rotas de dashboard (HTML). Redireciona para /login se não autenticado.
 */
export function requireAuth(c, next) {
  const session = getCookie(c, 'session');
  if (!session) return c.redirect('/login');

  try {
    const data = JSON.parse(Buffer.from(session, 'base64').toString('utf-8'));
    if (!data.userId || !data.email) return c.redirect('/login');
    c.set('user', data);
    return next();
  } catch {
    return c.redirect('/login');
  }
}

/**
 * Protege rotas de API. Aceita sessão (cookie) OU API key (X-API-Key / Bearer).
 * Retorna 401 JSON em vez de redirecionar.
 */
export async function requireAuthApi(c, next) {
  // 1. Tenta API key se o header estiver presente
  const rawKey = c.req.header('X-API-Key') ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');

  if (rawKey) {
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const { data: keyRow } = await supabase.from('api_keys')
      .select('id, user_id')
      .eq('key_hash', hash)
      .maybeSingle();

    if (keyRow) {
      const { data: userRow } = await supabase.from('users')
        .select('id, email, name')
        .eq('id', keyRow.user_id)
        .maybeSingle();

      if (userRow) {
        supabase.from('api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', keyRow.id)
          .then(() => {});

        c.set('user', { userId: userRow.id, email: userRow.email, name: userRow.name });
        return next();
      }
    }

    return c.json({ erro: 'API key inválida.' }, 401);
  }

  // 2. Tenta sessão via cookie
  const session = getCookie(c, 'session');
  if (session) {
    try {
      const data = JSON.parse(Buffer.from(session, 'base64').toString('utf-8'));
      if (data.userId && data.email) {
        c.set('user', data);
        return next();
      }
    } catch {}
  }

  return c.json({ erro: 'Autenticação necessária. Use sessão ou o header X-API-Key.' }, 401);
}
