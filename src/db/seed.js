import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { supabase } from './index.js';
import { randomUUID } from 'crypto';

const email = process.argv[2] || 'admin@wacapi.com';
const senha = process.argv[3] || 'admin123';
const nome = process.argv[4] || 'Administrador';

const { data: existente } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
if (existente) {
  console.log(`⚠️  Usuário com email ${email} já existe. Pulando.`);
  process.exit(0);
}

const hash = bcrypt.hashSync(senha, 12);
const { error } = await supabase.from('users').insert({
  id: randomUUID(),
  email,
  password_hash: hash,
  name: nome,
});

if (error) {
  console.error('❌ Erro ao criar usuário:', error.message);
  process.exit(1);
}

console.log('✅ Usuário criado com sucesso!');
console.log(`   Email: ${email}`);
console.log(`   Senha: ${senha}`);
console.log('⚠️  Troque a senha após o primeiro login!');
