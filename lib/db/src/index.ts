import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error("TURSO_DATABASE_URL environment variable is required");

const client = createClient({ url, authToken });

// Auto-create tables on startup
await client.executeMultiple(`
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
  CREATE TABLE IF NOT EXISTS channel_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_name TEXT NOT NULL,
    channel_url TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    seen_by_user INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    pricing_text TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    trial_minutes INTEGER NOT NULL DEFAULT 30
  );
`);

// Seed default settings on first boot
const settingsRes = await client.execute("SELECT COUNT(*) AS n FROM settings");
if ((settingsRes.rows[0].n as number) === 0) {
  await client.execute({
    sql: "INSERT INTO settings (id, pricing_text, whatsapp_number, trial_minutes) VALUES (1, ?, ?, 30)",
    args: [
      "Monthly: MWK 5,000 — 30 days. Quarterly: MWK 13,000 — 90 days. Yearly: MWK 45,000 — 365 days. Contact via WhatsApp to upgrade.",
      "265993702468",
    ],
  });
}

// Seed starter categories on first boot
const catRes = await client.execute("SELECT COUNT(*) AS n FROM categories");
if ((catRes.rows[0].n as number) === 0) {
  const now = Date.now();
  for (const name of ["Sports", "News", "Movies", "Kids", "Music"]) {
    await client.execute({
      sql: "INSERT INTO categories (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
      args: [crypto.randomUUID(), name, name.toLowerCase(), now],
    });
  }
}

export const db = drizzle(client, { schema });
export * from "./schema";
