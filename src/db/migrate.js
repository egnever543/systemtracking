import 'dotenv/config';
import { sqlite } from './index.js';

// Cria as tabelas diretamente via SQL (sem precisar de arquivos de migration gerados)
const migrations = sqlite.transaction(() => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL,
      fb_pixel_id TEXT,
      fb_access_token TEXT,
      fb_test_event_code TEXT,
      default_message TEXT DEFAULT 'Olá, vim pelo anúncio e quero saber mais!',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      tracking_id TEXT NOT NULL UNIQUE,
      fbclid TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      ip_original TEXT,
      page_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      value REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      registered_by TEXT REFERENCES users(id),
      registered_at TEXT DEFAULT (datetime('now')),
      fb_response TEXT,
      fb_sent_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_site_id ON events(site_id);
    CREATE INDEX IF NOT EXISTS idx_events_tracking_id ON events(tracking_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversions_site_id ON conversions(site_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_event_id ON conversions(event_id);
  `);
});

migrations();
console.log('✅ Banco de dados migrado com sucesso!');
