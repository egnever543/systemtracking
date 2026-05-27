import 'dotenv/config';
import { supabase } from './index.js';

const { error } = await supabase.from('users').select('id').limit(1);

if (error) {
  console.error('❌ Erro ao conectar com o Supabase:', error.message);
  console.error('   Verifique SUPABASE_URL e SUPABASE_SERVICE_KEY no .env');
  process.exit(1);
}

console.log('✅ Conexão com Supabase OK!');
console.log('   As tabelas devem ser criadas via SQL Editor no painel do Supabase.');
