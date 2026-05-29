-- Adiciona logo_url à tabela de usuários
ALTER TABLE users ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- IMPORTANTE: Criar um bucket PÚBLICO chamado "logos" no Supabase Storage
-- Painel Supabase → Storage → New Bucket → nome: logos → Public: true
