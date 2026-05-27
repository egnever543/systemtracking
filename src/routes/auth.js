import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
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

auth.get('/register', (c) => {
  const html = readFileSync(join(viewsDir, 'register.html'), 'utf-8');
  return c.html(html);
});

auth.post('/register', async (c) => {
  const body = await c.req.parseBody();
  const { nome, email, senha, confirmar_senha } = body;

  if (!nome || !email || !senha || !confirmar_senha) {
    return c.redirect('/register?erro=Preencha+todos+os+campos');
  }

  if (senha !== confirmar_senha) {
    return c.redirect('/register?erro=As+senhas+n%C3%A3o+coincidem');
  }

  if (senha.length < 8) {
    return c.redirect('/register?erro=A+senha+deve+ter+no+m%C3%ADnimo+8+caracteres');
  }

  const existente = db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  if (existente) {
    return c.redirect('/register?erro=Este+email+j%C3%A1+est%C3%A1+cadastrado');
  }

  const hash = bcrypt.hashSync(senha, 12);
  const id = randomUUID();
  const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  db.insert(users).values({
    id,
    email: email.trim().toLowerCase(),
    passwordHash: hash,
    name: nome.trim(),
    trialEndsAt,
    subscriptionStatus: 'trialing',
  }).run();

  return c.redirect('/login?msg=Conta+criada+com+sucesso!+Fa%C3%A7a+o+login.');
});

export default auth;
