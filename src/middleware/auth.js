import { getCookie } from 'hono/cookie';

/**
 * Protege rotas que exigem login.
 * Redireciona para /login se a sessão não existir.
 */
export function requireAuth(c, next) {
  const session = getCookie(c, 'session');
  if (!session) {
    return c.redirect('/login');
  }

  try {
    const data = JSON.parse(Buffer.from(session, 'base64').toString('utf-8'));
    if (!data.userId || !data.email) {
      return c.redirect('/login');
    }
    c.set('user', data);
    return next();
  } catch {
    return c.redirect('/login');
  }
}
