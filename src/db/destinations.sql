-- Run in Supabase SQL Editor
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_logo_url TEXT;
ALTER TABLE site_numbers ADD COLUMN IF NOT EXISTS destination_type TEXT NOT NULL DEFAULT 'whatsapp';
