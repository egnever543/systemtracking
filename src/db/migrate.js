import 'dotenv/config';
import { db, client } from './index.js';
import { sql } from 'drizzle-orm';

async function migrate() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT NOW()::text,
      trial_ends_at TEXT,
      subscription_status TEXT DEFAULT 'trialing',
      subscription_expires_at TEXT,
      mp_subscription_id TEXT
    )
  `);

  await db.execute(sql`
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
      created_at TEXT DEFAULT NOW()::text
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      tracking_id TEXT NOT NULL UNIQUE,
      fbclid TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      ip_original TEXT,
      page_url TEXT,
      created_at TEXT DEFAULT NOW()::text
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      value REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      registered_by TEXT REFERENCES users(id),
      registered_at TEXT DEFAULT NOW()::text,
      fb_response TEXT,
      fb_sent_at TEXT
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_events_site_id ON events(site_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_events_tracking_id ON events(tracking_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conversions_site_id ON conversions(site_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conversions_event_id ON conversions(event_id)`);

  console.log('✅ Banco de dados migrado com sucesso!');
  await client.end();
}

migrate().catch((e) => { console.error(e); process.exit(1); });
