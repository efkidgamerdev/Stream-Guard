import { Router, type IRouter, type Request, type Response } from "express";
import { db, channelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyStreamToken, signStreamToken } from "../lib/streamToken.js";

const router: IRouter = Router();

const HOP_HEADERS = new Set([
  "connection", "keep-alive", "transfer-encoding", "te", "trailer",
  "proxy-authorization", "proxy-authenticate", "upgrade", "host", "content-length",
]);

function pickForwardableHeaders(src: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  src.forEach((v, k) => {
    if (!HOP_HEADERS.has(k.toLowerCase())) out[k] = v;
  });
  return out;
}

function rewriteUrlInPlaylist(line: string, base: URL, token: string): string {
  // Resolve to absolute, then encode as ?u=<base64url>
  const abs = new URL(line, base).toString();
  const enc = Buffer.from(abs, "utf8").toString("base64url");
  return `/api/stream/p/${token}/seg?u=${enc}`;
}

function rewriteAttrUriInLine(line: string, base: URL, token: string): string {
  // Replace URI="..." in EXT-X tags
  return line.replace(/URI="([^"]+)"/g, (_m, url: string) => {
    const abs = new URL(url, base).toString();
    const enc = Buffer.from(abs, "utf8").toString("base64url");
    return `URI="/api/stream/p/${token}/seg?u=${enc}"`;
  });
}

async function fetchUpstream(url: string, req: Request): Promise<globalThis.Response> {
  // Forward client UA per user request, plus identity-friendly headers
  const headers: Record<string, string> = {
    "User-Agent": (req.headers["user-agent"] as string | undefined) ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "identity",
  };
  const range = req.headers["range"];
  if (typeof range === "string") headers["Range"] = range;
  const referer = req.query["ref"] as string | undefined;
  if (referer) headers["Referer"] = referer;

  return await fetch(url, { headers, redirect: "follow" });
}

router.get("/p/:token/index.m3u8", async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const payload = verifyStreamToken(token);
  if (!payload) { res.status(401).send("Invalid token"); return; }
  const [c] = await db.select().from(channelsTable).where(eq(channelsTable.id, payload.cid)).limit(1);
  if (!c) { res.status(404).send("Channel not found"); return; }

  let upstream: globalThis.Response;
  try {
    upstream = await fetchUpstream(c.sourceUrl, req);
  } catch (err) {
    req.log?.error({ err }, "Stream upstream failed");
    res.status(502).send("Upstream error");
    return;
  }

  if (!upstream.ok) {
    res.status(upstream.status).send("Upstream returned error");
    return;
  }

  const text = await upstream.text();
  const baseUrl = new URL(c.sourceUrl);

  // If this is a master playlist, rewrite variant URIs. Then segment URIs.
  const out = text.split(/\r?\n/).map((line) => {
    if (line.startsWith("#")) {
      // Tags with URI attribute
      if (line.includes("URI=")) return rewriteAttrUriInLine(line, baseUrl, token);
      return line;
    }
    if (line.trim() === "") return line;
    // It's a playlist or segment URI
    return rewriteUrlInPlaylist(line.trim(), baseUrl, token);
  }).join("\n");

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.send(out);
});

// Generic segment / sub-playlist passthrough
router.get("/p/:token/seg", async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const payload = verifyStreamToken(token);
  if (!payload) { res.status(401).send("Invalid token"); return; }
  const u = req.query["u"] as string | undefined;
  if (!u) { res.status(400).send("Missing u"); return; }
  let absUrl: string;
  try {
    absUrl = Buffer.from(u, "base64url").toString("utf8");
    new URL(absUrl); // validate
  } catch {
    res.status(400).send("Bad u");
    return;
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetchUpstream(absUrl, req);
  } catch (err) {
    req.log?.error({ err }, "Stream segment upstream failed");
    res.status(502).send("Upstream error");
    return;
  }

  // If this is also a m3u8 (variant), rewrite same way
  const ct = upstream.headers.get("content-type") || "";
  const isPlaylist = /mpegurl|m3u8/i.test(ct) || /\.m3u8(\?|$)/i.test(absUrl);

  if (isPlaylist) {
    const text = await upstream.text();
    const baseUrl = new URL(absUrl);
    const out = text.split(/\r?\n/).map((line) => {
      if (line.startsWith("#")) {
        if (line.includes("URI=")) return rewriteAttrUriInLine(line, baseUrl, token);
        return line;
      }
      if (line.trim() === "") return line;
      return rewriteUrlInPlaylist(line.trim(), baseUrl, token);
    }).join("\n");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(out);
    return;
  }

  // Forward status + relevant headers and stream body
  res.status(upstream.status);
  const fwd = pickForwardableHeaders(upstream.headers);
  for (const [k, v] of Object.entries(fwd)) res.setHeader(k, v);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!upstream.body) { res.end(); return; }

  const reader = upstream.body.getReader();
  const flush = (res as Response & { flush?: () => void }).flush;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        res.write(Buffer.from(value));
        if (typeof flush === "function") flush.call(res);
      }
    }
    res.end();
  } catch (err) {
    req.log?.error({ err }, "Stream pipe error");
    try { res.end(); } catch { /* */ }
  }
});

export default router;
// re-export helpers (avoid unused import warnings)
export { signStreamToken };
