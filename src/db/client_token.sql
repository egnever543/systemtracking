ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS client_token TEXT,
  ADD COLUMN IF NOT EXISTS client_access_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS sites_client_token_idx ON sites (client_token) WHERE client_token IS NOT NULL;
