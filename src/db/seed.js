import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, client } from './index.js';
import { users } from './schema.js';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

const email = process.argv[2] || 'admin@wacapi.com';
const senha = process.argv[3] || 'admin123';
const nome = process.argv[4] || 'Administrador';

const [existente] = await db.select().from(users).where(eq(users.email, email));
if (existente) {
  console.log(`⚠️  Usuário com email ${email} já existe. Pulando.`);
  await client.end();
  process.exit(0);
}

const hash = bcrypt.hashSync(senha, 12);
await db.insert(users).values({ id: randomUUID(), email, passwordHash: hash, name: nome });

console.log('✅ Usuário criado com sucesso!');
console.log(`   Email: ${email}`);
console.log(`   Senha: ${senha}`);
console.log('⚠️  Troque a senha após o primeiro login!');
await client.end();
