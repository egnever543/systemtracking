import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { supabase } from '../db/index.js';
import { mapUser } from '../db/mappers.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCookie, setCookie as setC } from 'hono/cookie';
import { getTranslations, detectLocale } from '../i18n/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '../../views');

const auth = new Hono();

auth.get('/login', (c) => {
  const locale = detectLocale(c);
  const t = getTranslations(locale);
  let html = readFileSync(join(viewsDir, 'login.html'), 'utf-8');
  html = html.replaceAll('{{locale}}', locale);
  for (const [k, v] of Object.entries(t)) {
    html = html.replaceAll(`{{t_${k}}}`, v);
  }
  return c.html(html);
});

auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const { email, senha } = body;

  if (!email || !senha) {
    return c.redirect('/login?erro=Preencha+todos+os+campos');
  }

  const { data: raw } = await supabase.from('users').select('*').eq('email', email.trim()).maybeSingle();
  const user = mapUser(raw);

  if (!user || !bcrypt.compareSync(senha, user.passwordHash)) {
    return c.redirect('/login?erro=Email+ou+senha+incorretos');
  }

  const userLocale = raw?.locale || 'pt';

  const sessionData = Buffer.from(
    JSON.stringify({ userId: user.id, email: user.email, name: user.name })
  ).toString('base64');

  setCookie(c, 'session', sessionData, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });

  setC(c, 'locale', userLocale, {
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return c.redirect('/dashboard');
});

auth.get('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  return c.redirect('/login');
});

auth.get('/register', (c) => {
  const locale = detectLocale(c);
  const t = getTranslations(locale);
  let html = readFileSync(join(viewsDir, 'register.html'), 'utf-8');
  html = html.replaceAll('{{locale}}', locale);
  const defaultCountry = locale === 'en' ? 'us' : 'br';
  html = html.replaceAll('{{countryBRSelected}}', defaultCountry === 'br' ? 'selected' : '');
  html = html.replaceAll('{{countryUSSelected}}', defaultCountry === 'us' ? 'selected' : '');
  for (const [k, v] of Object.entries(t)) {
    html = html.replaceAll(`{{t_${k}}}`, v);
  }
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

  const { data: existente } = await supabase.from('users').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (existente) {
    return c.redirect('/register?erro=Este+email+j%C3%A1+est%C3%A1+cadastrado');
  }

  const country = body.country === 'us' ? 'us' : 'br';
  const locale = country === 'us' ? 'en' : 'pt';

  const hash = bcrypt.hashSync(senha, 12);
  const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('users').insert({
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    password_hash: hash,
    name: nome.trim(),
    trial_ends_at: trialEndsAt,
    subscription_status: 'trialing',
    country,
    locale,
  });

  return c.redirect('/login?msg=Conta+criada+com+sucesso!+Fa%C3%A7a+o+login.');
});

export default auth;
