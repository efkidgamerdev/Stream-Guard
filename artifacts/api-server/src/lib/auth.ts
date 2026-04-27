import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const ADMIN_EMAIL = "efkidgamer@gmail.com";
const COOKIE_NAME = "channelzz_session";
const SESSION_TTL_DAYS = 30;

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required");
  return s;
}

export interface AuthedRequest extends Request {
  userId?: string;
  userRow?: typeof usersTable.$inferSelect;
}

export function issueSessionCookie(res: Response, userId: string) {
  const token = jwt.sign({ uid: userId }, getSecret(), { expiresIn: `${SESSION_TTL_DAYS}d` });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,           // ← always true so sameSite=none works
    sameSite: "none",       // ← changed from "lax" — required for iframe login
    maxAge: SESSION_TTL_DAYS * 86400 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSessionUserId(req: Request): string | null {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getSecret()) as { uid?: string };
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

export async function bumpSession(userId: string, req: Request) {
  const ua = (req.headers["user-agent"] as string | undefined) ?? null;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!existing) return null;
  const [row] = await db
    .update(usersTable)
    .set({
      lastSeenAt: new Date(),
      lastUserAgent: ua,
      sessionsCount: (existing.sessionsCount ?? 0) + 1,
    })
    .where(eq(usersTable.id, userId))
    .returning();
  return row ?? existing;
}

export async function loadUser(userId: string) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return row ?? null;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = readSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const row = await loadUser(userId);
  if (!row) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  req.userRow = row;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.userRow?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function userAccessStatus(row: typeof usersTable.$inferSelect): "trial" | "paid" | "expired" | "banned" {
  if (row.banned) return "banned";
  const now = Date.now();
  if (row.subscriptionEndsAt && row.subscriptionEndsAt.getTime() > now) return "paid";
  if (row.trialEndsAt && row.trialEndsAt.getTime() > now) return "trial";
  return "expired";
}

export function userHasAccess(row: typeof usersTable.$inferSelect): boolean {
  if (row.role === "admin") return true;
  const s = userAccessStatus(row);
  return s === "trial" || s === "paid";
}

export async function getDefaultTrialMillis(): Promise<number> {
  const [s] = await db.select().from(settingsTable).limit(1);
  const hours = s?.trialHours ?? 4;
  return hours * 3600 * 1000;
}
