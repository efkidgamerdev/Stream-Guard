import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data/channelzz.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Auto-create tables on startup. Idempotent.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    banned INTEGER NOT NULL DEFAULT 0,
    trial_ends_at INTEGER,
    subscription_ends_at INTEGER,
    last_seen_at INTEGER,
    last_user_agent TEXT,
    sessions_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    logo_url TEXT NOT NULL,
    source_url TEXT NOT NULL,
    is_live INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    pricing_text TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    trial_minutes INTEGER NOT NULL DEFAULT 30
  );
`);

// Seed default settings + starter categories on first boot
const settingsCount = sqlite.prepare("SELECT COUNT(*) AS n FROM settings").get() as { n: number };
if (settingsCount.n === 0) {
  sqlite.prepare(
    "INSERT INTO settings (id, pricing_text, whatsapp_number, trial_minutes) VALUES (1, ?, ?, 30)"
  ).run(
    "Monthly: MWK 5,000 — 30 days. Quarterly: MWK 13,000 — 90 days. Yearly: MWK 45,000 — 365 days. Contact via WhatsApp to upgrade.",
    "265993702468",
  );
}

const catCount = sqlite.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
if (catCount.n === 0) {
  const insert = sqlite.prepare(
    "INSERT INTO categories (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  );
  const now = Date.now();
  for (const name of ["Sports", "News", "Movies", "Kids", "Music"]) {
    insert.run(crypto.randomUUID(), name, name.toLowerCase(), now);
  }
}

export const db = drizzle(sqlite, { schema });
export const sqliteClient: DatabaseType = sqlite;
export * from "./schema";
