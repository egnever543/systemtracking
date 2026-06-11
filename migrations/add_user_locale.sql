-- Multi-country support: locale, country, Stripe IDs
-- Execute no SQL Editor do Supabase (Database → SQL Editor)

ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'pt';
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'br';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
