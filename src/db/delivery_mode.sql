-- Run in Supabase SQL Editor
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS vsl_video_url TEXT,
  ADD COLUMN IF NOT EXISTS vsl_delay_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS form_fields JSONB DEFAULT '[{"type":"name","label":"Seu nome","required":true},{"type":"phone","label":"Seu telefone","required":true}]'::jsonb;

-- Migrate sites that had presell enabled
UPDATE sites SET delivery_mode = 'presell' WHERE presell_enabled = true;
