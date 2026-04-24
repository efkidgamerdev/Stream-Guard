import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, categoriesTable, channelsTable, announcementsTable, settingsTable } from "@workspace/db";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import { requireAuth, requireAdmin, userAccessStatus, userHasAccess, type AuthedRequest } from "../lib/auth.js";
import { signStreamToken } from "../lib/streamToken.js";
import streamRouter from "./stream.js";

const router: IRouter = Router();

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `cat-${Date.now()}`;
}

function serializeChannel(c: typeof channelsTable.$inferSelect, categoryName: string) {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? undefined,
    categoryId: c.categoryId,
    categoryName,
    logoUrl: c.logoUrl,
    isLive: c.isLive,
    createdAt: c.createdAt.toISOString(),
  };
}

// --- Stream proxy (no auth — token-based) ---
router.use("/stream", streamRouter);

// --- Public ---
router.get("/categories", async (_req, res) => {
  const rows = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  res.json(rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.createdAt.toISOString() })));
});

router.get("/announcements", async (_req, res) => {
  // auto-cleanup expired
  await db.delete(announcementsTable).where(sql`${announcementsTable.expiresAt} < now()`);
  const rows = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt));
  res.json(rows.map(r => ({
    id: r.id, title: r.title, body: r.body,
    createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
  })));
});

router.get("/settings", async (_req, res) => {
  const [s] = await db.select().from(settingsTable).limit(1);
  if (!s) {
    res.json({ pricingText: "Contact admin for pricing.", whatsappNumber: "265993702468", trialHours: 4 });
    return;
  }
  res.json({ pricingText: s.pricingText, whatsappNumber: s.whatsappNumber, trialHours: s.trialHours });
});

router.get("/channels", async (_req, res) => {
  const rows = await db
    .select({
      id: channelsTable.id,
      name: channelsTable.name,
      description: channelsTable.description,
      categoryId: channelsTable.categoryId,
      categoryName: categoriesTable.name,
      logoUrl: channelsTable.logoUrl,
      isLive: channelsTable.isLive,
      createdAt: channelsTable.createdAt,
    })
    .from(channelsTable)
    .innerJoin(categoriesTable, eq(channelsTable.categoryId, categoriesTable.id))
    .orderBy(channelsTable.name);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), description: r.description ?? undefined })));
});

router.get("/channels/:id", async (req, res) => {
  const id = String(req.params.id);
  const [r] = await db
    .select({
      id: channelsTable.id,
      name: channelsTable.name,
      description: channelsTable.description,
      categoryId: channelsTable.categoryId,
      categoryName: categoriesTable.name,
      logoUrl: channelsTable.logoUrl,
      isLive: channelsTable.isLive,
      createdAt: channelsTable.createdAt,
    })
    .from(channelsTable)
    .innerJoin(categoriesTable, eq(channelsTable.categoryId, categoriesTable.id))
    .where(eq(channelsTable.id, id))
    .limit(1);
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...r, createdAt: r.createdAt.toISOString(), description: r.description ?? undefined });
});

// --- Authenticated ---
router.get("/me", async (req: AuthedRequest, res: Response) => {
  // Use requireAuth-like flow but allow unauth
  const { getAuth } = await import("@clerk/express");
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims as { userId?: string } | undefined)?.userId || auth?.userId;
  if (!userId) {
    res.json({ authenticated: false });
    return;
  }
  // run requireAuth's bootstrap
  await new Promise<void>((resolve) => requireAuth(req, res as Response, resolve as () => void));
  if (res.headersSent) return;
  const row = req.userRow!;
  res.json({
    authenticated: true,
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    role: row.role,
    access: userAccessStatus(row),
    trialEndsAt: row.trialEndsAt ? row.trialEndsAt.toISOString() : null,
    subscriptionEndsAt: row.subscriptionEndsAt ? row.subscriptionEndsAt.toISOString() : null,
    banned: row.banned,
  });
});

router.post("/channels/:id/play", requireAuth, async (req: AuthedRequest, res: Response) => {
  const id = String(req.params.id);
  const row = req.userRow!;
  if (!userHasAccess(row)) { res.status(403).json({ error: "No active subscription" }); return; }
  const [c] = await db.select().from(channelsTable).where(eq(channelsTable.id, id)).limit(1);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const ttl = 60 * 60; // 1 hour
  const token = signStreamToken({ cid: c.id, uid: row.id }, ttl);
  const playlistUrl = `/api/stream/p/${token}/index.m3u8`;
  res.json({ playlistUrl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() });
});

// --- Admin ---
router.post("/categories", requireAuth, requireAdmin, async (req, res) => {
  const name = String((req.body as { name?: string }).name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const slug = slugify(name);
  const [r] = await db.insert(categoriesTable).values({ name, slug }).returning();
  res.json({ id: r!.id, name: r!.name, slug: r!.slug, createdAt: r!.createdAt.toISOString() });
});

router.delete("/categories/:id", requireAuth, requireAdmin, async (req, res) => {
  await db.delete(categoriesTable).where(eq(categoriesTable.id, String(req.params.id)));
  res.json({ ok: true });
});

router.post("/channels", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body as { name?: string; description?: string; categoryId?: string; logoUrl?: string; sourceUrl?: string; isLive?: boolean };
  if (!b.name || !b.categoryId || !b.logoUrl || !b.sourceUrl) { res.status(400).json({ error: "Missing fields" }); return; }
  const [c] = await db.insert(channelsTable).values({
    name: b.name, description: b.description ?? null, categoryId: b.categoryId,
    logoUrl: b.logoUrl, sourceUrl: b.sourceUrl, isLive: b.isLive ?? true,
  }).returning();
  const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, c!.categoryId)).limit(1);
  res.json(serializeChannel(c!, cat?.name ?? ""));
});

router.patch("/channels/:id", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body as Partial<{ name: string; description: string; categoryId: string; logoUrl: string; sourceUrl: string; isLive: boolean }>;
  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.description !== undefined) update.description = b.description;
  if (b.categoryId !== undefined) update.categoryId = b.categoryId;
  if (b.logoUrl !== undefined) update.logoUrl = b.logoUrl;
  if (b.sourceUrl !== undefined && b.sourceUrl !== "") update.sourceUrl = b.sourceUrl;
  if (b.isLive !== undefined) update.isLive = b.isLive;
  const [c] = await db.update(channelsTable).set(update).where(eq(channelsTable.id, String(req.params.id))).returning();
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, c.categoryId)).limit(1);
  res.json(serializeChannel(c, cat?.name ?? ""));
});

router.delete("/channels/:id", requireAuth, requireAdmin, async (req, res) => {
  await db.delete(channelsTable).where(eq(channelsTable.id, String(req.params.id)));
  res.json({ ok: true });
});

router.post("/announcements", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body as { title?: string; body?: string };
  if (!b.title || !b.body) { res.status(400).json({ error: "Missing fields" }); return; }
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  const [a] = await db.insert(announcementsTable).values({ title: b.title, body: b.body, expiresAt }).returning();
  res.json({ id: a!.id, title: a!.title, body: a!.body, createdAt: a!.createdAt.toISOString(), expiresAt: a!.expiresAt.toISOString() });
});

router.delete("/announcements/:id", requireAuth, requireAdmin, async (req, res) => {
  await db.delete(announcementsTable).where(eq(announcementsTable.id, String(req.params.id)));
  res.json({ ok: true });
});

router.put("/settings", requireAuth, requireAdmin, async (req, res) => {
  const b = req.body as { pricingText?: string; whatsappNumber?: string; trialHours?: number };
  if (!b.pricingText || !b.whatsappNumber || b.trialHours === undefined) { res.status(400).json({ error: "Missing fields" }); return; }
  const [s] = await db
    .insert(settingsTable)
    .values({ id: 1, pricingText: b.pricingText, whatsappNumber: b.whatsappNumber, trialHours: b.trialHours })
    .onConflictDoUpdate({
      target: settingsTable.id,
      set: { pricingText: b.pricingText, whatsappNumber: b.whatsappNumber, trialHours: b.trialHours },
    })
    .returning();
  res.json({ pricingText: s!.pricingText, whatsappNumber: s!.whatsappNumber, trialHours: s!.trialHours });
});

router.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(rows.map(r => ({
    id: r.id, email: r.email,
    name: r.name ?? null, avatarUrl: r.avatarUrl ?? null,
    role: r.role as "admin" | "user",
    access: userAccessStatus(r),
    banned: r.banned,
    trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
    subscriptionEndsAt: r.subscriptionEndsAt ? r.subscriptionEndsAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
    lastUserAgent: r.lastUserAgent ?? null,
    sessionsCount: r.sessionsCount,
  })));
});

router.patch("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const b = req.body as { addDays?: number; setSubscriptionEndsAt?: string | null; banned?: boolean };
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const update: Record<string, unknown> = {};
  if (typeof b.addDays === "number") {
    const base = existing.subscriptionEndsAt && existing.subscriptionEndsAt.getTime() > Date.now()
      ? existing.subscriptionEndsAt.getTime() : Date.now();
    update.subscriptionEndsAt = new Date(base + b.addDays * 86400 * 1000);
  }
  if (b.setSubscriptionEndsAt !== undefined) {
    update.subscriptionEndsAt = b.setSubscriptionEndsAt ? new Date(b.setSubscriptionEndsAt) : null;
  }
  if (typeof b.banned === "boolean") update.banned = b.banned;
  const [r] = await db.update(usersTable).set(update).where(eq(usersTable.id, id)).returning();
  res.json({
    id: r!.id, email: r!.email, name: r!.name ?? null, avatarUrl: r!.avatarUrl ?? null,
    role: r!.role as "admin" | "user",
    access: userAccessStatus(r!),
    banned: r!.banned,
    trialEndsAt: r!.trialEndsAt ? r!.trialEndsAt.toISOString() : null,
    subscriptionEndsAt: r!.subscriptionEndsAt ? r!.subscriptionEndsAt.toISOString() : null,
    createdAt: r!.createdAt.toISOString(),
    lastSeenAt: r!.lastSeenAt ? r!.lastSeenAt.toISOString() : null,
    lastUserAgent: r!.lastUserAgent ?? null,
    sessionsCount: r!.sessionsCount,
  });
});

router.get("/admin/stats", requireAuth, requireAdmin, async (_req, res) => {
  const totalUsersR = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable);
  const bannedR = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.banned, true));
  const paidR = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable).where(and(eq(usersTable.banned, false), gt(usersTable.subscriptionEndsAt, new Date())));
  const trialR = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable).where(and(eq(usersTable.banned, false), gt(usersTable.trialEndsAt, new Date())));
  const channelsR = await db.select({ c: sql<number>`count(*)::int` }).from(channelsTable);
  const catsR = await db.select({ c: sql<number>`count(*)::int` }).from(categoriesTable);
  const recent = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(8);
  const totalUsers = totalUsersR[0]?.c ?? 0;
  const banned = bannedR[0]?.c ?? 0;
  const paid = paidR[0]?.c ?? 0;
  const trial = trialR[0]?.c ?? 0;
  res.json({
    totalUsers,
    activeUsers: paid + trial,
    paidUsers: paid,
    trialUsers: trial,
    bannedUsers: banned,
    totalChannels: channelsR[0]?.c ?? 0,
    totalCategories: catsR[0]?.c ?? 0,
    recentSignups: recent.map(u => ({ id: u.id, email: u.email, name: u.name ?? null, createdAt: u.createdAt.toISOString() })),
  });
});

export default router;
