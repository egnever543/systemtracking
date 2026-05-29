-- Migration: API Keys
-- Execute no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,
  label        TEXT        NOT NULL DEFAULT 'Chave sem nome',
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id  ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
