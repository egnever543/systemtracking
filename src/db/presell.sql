ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS presell_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS presell_title TEXT,
  ADD COLUMN IF NOT EXISTS presell_subtitle TEXT,
  ADD COLUMN IF NOT EXISTS presell_bullets JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS presell_cta_text TEXT DEFAULT 'Falar no WhatsApp',
  ADD COLUMN IF NOT EXISTS presell_bg_color TEXT DEFAULT '#0f172a',
  ADD COLUMN IF NOT EXISTS presell_accent_color TEXT DEFAULT '#25D366';
