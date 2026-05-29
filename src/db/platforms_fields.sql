-- Migration: Google Ads CAPI + TikTok Pixel
-- Execute no SQL Editor do Supabase

ALTER TABLE sites ADD COLUMN IF NOT EXISTS google_customer_id          TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS google_conversion_action_id TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS google_developer_token      TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS google_refresh_token        TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tiktok_pixel_id             TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tiktok_access_token         TEXT;
