import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import crypto from "crypto";

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const derived = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(hash, "hex"));
}

function storePassword(password: string): string {
  const salt = createSalt();
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

export function registerAuthRoutes(app: Express) {
  // ── POST /api/auth/register ───────────────────────────────────────────────
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email et mot de passe requis." });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères." });
      return;
    }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const openId = `local:${email.toLowerCase().trim()}`;

    const existing = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    if (existing[0]) {
      res.status(409).json({ error: "Un compte existe déjà avec cet email." });
      return;
    }

    const passwordHash = storePassword(password);
    const isOwner = ENV.ownerOpenId && openId === ENV.ownerOpenId;

    await db.insert(users).values({
      openId,
      email: email.toLowerCase().trim(),
      name: name || email.split("@")[0],
      loginMethod: "email",
      passwordHash,
      role: isOwner ? "ultra" : "user",
      plan: isOwner ? "agency" : "free",
      generationsLimit: isOwner ? 999999 : 3,
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(openId, {
      name: name || email.split("@")[0],
      expiresInMs: ONE_YEAR_MS,
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ success: true });
  });

  // ── POST /api/auth/login ──────────────────────────────────────────────────
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email et mot de passe requis." });
      return;
    }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const openId = `local:${email.toLowerCase().trim()}`;
    const userRow = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    const user = userRow[0];

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }

    if (!verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }

    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.openId, openId));

    const sessionToken = await sdk.createSessionToken(openId, {
      name: user.name || email.split("@")[0],
      expiresInMs: ONE_YEAR_MS,
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ success: true });
  });
}
