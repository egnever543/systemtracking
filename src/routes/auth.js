import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const auth = new Hono();

auth.get('/login', (c) => {
  const html = readFileSync(join(viewsDir, 'login.html'), 'utf-8');
  return c.html(html);
});

auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const { email, senha } = body;

  if (!email || !senha) {
    return c.redirect('/login?erro=Preencha+todos+os+campos');
  }

  const user = db.select().from(users).where(eq(users.email, email.trim())).get();

  if (!user || !bcrypt.compareSync(senha, user.passwordHash)) {
    return c.redirect('/login?erro=Email+ou+senha+incorretos');
  }

  const sessionData = Buffer.from(
    JSON.stringify({ userId: user.id, email: user.email, name: user.name })
  ).toString('base64');

  setCookie(c, 'session', sessionData, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7, // 7 dias
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });

  return c.redirect('/dashboard');
});

auth.get('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  return c.redirect('/login');
});

export default auth;
