import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const uuid = () => crypto.randomUUID();

export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(uuid),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("user"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp_ms" }),
  subscriptionEndsAt: integer("subscription_ends_at", { mode: "timestamp_ms" }),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  lastUserAgent: text("last_user_agent"),
  sessionsCount: integer("sessions_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const categoriesTable = sqliteTable("categories", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const channelsTable = sqliteTable("channels", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  description: text("description"),
  categoryId: text("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url").notNull(),
  sourceUrl: text("source_url").notNull(),
  isLive: integer("is_live", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const announcementsTable = sqliteTable("announcements", {
  id: text("id").primaryKey().$defaultFn(uuid),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const channelRequestsTable = sqliteTable("channel_requests", {
  id: text("id").primaryKey().$defaultFn(uuid),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  channelName: text("channel_name").notNull(),
  channelUrl: text("channel_url"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  seenByUser: integer("seen_by_user", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const settingsTable = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  pricingText: text("pricing_text").notNull(),
  whatsappNumber: text("whatsapp_number").notNull(),
  trialMinutes: integer("trial_minutes").notNull().default(30),
});
