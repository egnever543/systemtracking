-- Run in Supabase SQL Editor
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS webhook_events JSONB DEFAULT '[]'::jsonb;
