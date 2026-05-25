import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const dbUrl = process.env.DATABASE_URL || './data/wacapi.db';

// Garante que o diretório existe antes de abrir o banco
mkdirSync(dirname(dbUrl), { recursive: true });

const sqlite = new Database(dbUrl);

// Otimizações de performance para SQLite
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };
