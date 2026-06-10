import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import crypto from "crypto";

/* ── Password helpers ─────────────────────────────────────────────────────── */

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

function validatePassword(password: string): string | null {
  if (password.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (!/[A-Z]/.test(password)) return "Le mot de passe doit contenir au moins 1 majuscule.";
  if (!/[@$!%*?&.#^()\-_=+\[\]{}|;:'",<>\/\\`~]/.test(password))
    return "Le mot de passe doit contenir au moins 1 caractère spécial.";
  return null;
}

/* ── Reset password store (in-memory, TTL 15 min) ────────────────────────── */

interface PendingReset {
  code: string;
  expiresAt: number;
  attempts: number;
}
const resetStore = new Map<string, PendingReset>();

setInterval(() => {
  const now = Date.now();
  resetStore.forEach((val, key) => { if (val.expiresAt < now) resetStore.delete(key); });
}, 5 * 60 * 1000);

/* ── OTP store (in-memory, TTL 15 min) ───────────────────────────────────── */

interface PendingRegistration {
  code: string;
  expiresAt: number;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  plan: string;
  generationsLimit: number;
  attempts: number;
}

const otpStore = new Map<string, PendingRegistration>();

// Cleanup expired entries every 5 min
setInterval(() => {
  const now = Date.now();
  otpStore.forEach((val, key) => {
    if (val.expiresAt < now) otpStore.delete(key);
  });
}, 5 * 60 * 1000);

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ── Email sender ─────────────────────────────────────────────────────────── */

async function sendResetEmail(to: string, code: string, name: string): Promise<void> {
  if (!ENV.resendApiKey) {
    console.log(`\n🔑  RESET OTP pour ${to} : ${code}\n`);
    return;
  }
  const { Resend } = await import("resend");
  const resend = new Resend(ENV.resendApiKey);
  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#6d28d9,#4f46e5);padding:32px 40px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">Mar-ia<span style="color:#a78bfa">.net</span></div>
          <div style="color:#c4b5fd;font-size:12px;letter-spacing:4px;margin-top:4px;">RÉINITIALISATION DU MOT DE PASSE</div>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="color:#e5e5e5;font-size:16px;margin:0 0 8px;">Bonjour <strong>${name}</strong>,</p>
          <p style="color:#a0a0a0;font-size:14px;margin:0 0 32px;">Utilisez ce code pour réinitialiser votre mot de passe Mar-ia :</p>
          <div style="text-align:center;margin:0 0 32px;">
            <div style="display:inline-block;background:#1a1a2e;border:2px solid #6d28d9;border-radius:12px;padding:20px 40px;">
              <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#a78bfa;font-family:monospace;">${code}</div>
            </div>
          </div>
          <p style="color:#a0a0a0;font-size:13px;text-align:center;margin:0 0 16px;">Ce code expire dans <strong style="color:#e5e5e5;">15 minutes</strong>.</p>
          <p style="color:#666;font-size:12px;text-align:center;margin:0;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #222;padding:20px 40px;text-align:center;">
          <p style="color:#444;font-size:12px;margin:0;">© 2025 Mar-ia · <a href="https://mar-ia.net" style="color:#6d28d9;text-decoration:none;">mar-ia.net</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  await resend.emails.send({
    from: "Mar-ia <contact@mar-ia.net>",
    to,
    subject: `${code} — Réinitialisation de votre mot de passe Mar-ia`,
    html,
  });
}

async function sendOtpEmail(to: string, code: string, name: string): Promise<void> {
  if (!ENV.resendApiKey) {
    // Dev fallback: log to console
    console.log(`\n📧  OTP pour ${to} : ${code}\n`);
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(ENV.resendApiKey);

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#6d28d9,#4f46e5);padding:32px 40px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">Mar-ia<span style="color:#a78bfa">.net</span></div>
          <div style="color:#c4b5fd;font-size:12px;letter-spacing:4px;margin-top:4px;">CRÉEZ. INNOVEZ ET PUBLIEZ SANS CODE.</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <p style="color:#e5e5e5;font-size:16px;margin:0 0 8px;">Bonjour <strong>${name}</strong>,</p>
          <p style="color:#a0a0a0;font-size:14px;margin:0 0 32px;">Voici votre code de vérification pour créer votre compte Mar-ia :</p>
          <!-- OTP -->
          <div style="text-align:center;margin:0 0 32px;">
            <div style="display:inline-block;background:#1a1a2e;border:2px solid #6d28d9;border-radius:12px;padding:20px 40px;">
              <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#a78bfa;font-family:monospace;">${code}</div>
            </div>
          </div>
          <p style="color:#a0a0a0;font-size:13px;text-align:center;margin:0 0 16px;">Ce code expire dans <strong style="color:#e5e5e5;">15 minutes</strong>.</p>
          <p style="color:#666;font-size:12px;text-align:center;margin:0;">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="border-top:1px solid #222;padding:20px 40px;text-align:center;">
          <p style="color:#444;font-size:12px;margin:0;">© 2025 Mar-ia · <a href="https://mar-ia.net" style="color:#6d28d9;text-decoration:none;">mar-ia.net</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: "Mar-ia <contact@mar-ia.net>",
    to,
    subject: `${code} — Votre code de vérification Mar-ia`,
    html,
  });
}

/* ── Routes ───────────────────────────────────────────────────────────────── */

export function registerAuthRoutes(app: Express) {

  // ── POST /api/auth/send-otp ───────────────────────────────────────────────
  app.post("/api/auth/send-otp", async (req: Request, res: Response) => {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email et mot de passe requis." });
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) { res.status(400).json({ error: pwError }); return; }

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
    const code = generateOtp();

    otpStore.set(openId, {
      code,
      expiresAt: Date.now() + 15 * 60 * 1000,
      name: name || email.split("@")[0],
      email: email.toLowerCase().trim(),
      passwordHash,
      role: isOwner ? "ultra" : "user",
      plan: isOwner ? "agency" : "free",
      generationsLimit: isOwner ? 999999 : 3,
      attempts: 0,
    });

    try {
      await sendOtpEmail(email.toLowerCase().trim(), code, name || email.split("@")[0]);
    } catch (err) {
      console.error("Email send error:", err);
      res.status(500).json({ error: "Impossible d'envoyer l'email de vérification." });
      return;
    }

    res.json({ sent: true });
  });

  // ── POST /api/auth/verify-otp ─────────────────────────────────────────────
  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || !code) {
      res.status(400).json({ error: "Email et code requis." });
      return;
    }

    const openId = `local:${email.toLowerCase().trim()}`;
    const pending = otpStore.get(openId);

    if (!pending) {
      res.status(400).json({ error: "Aucune demande d'inscription trouvée. Recommencez." });
      return;
    }
    if (Date.now() > pending.expiresAt) {
      otpStore.delete(openId);
      res.status(400).json({ error: "Code expiré. Recommencez l'inscription." });
      return;
    }

    pending.attempts++;
    if (pending.attempts > 5) {
      otpStore.delete(openId);
      res.status(429).json({ error: "Trop de tentatives. Recommencez l'inscription." });
      return;
    }

    if (pending.code !== code.trim()) {
      res.status(400).json({ error: `Code incorrect. ${5 - pending.attempts} essai(s) restant(s).` });
      return;
    }

    // Code correct → create account
    otpStore.delete(openId);

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    // Double-check no account was created in the meantime
    const existing = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    if (existing[0]) {
      res.status(409).json({ error: "Un compte existe déjà avec cet email." });
      return;
    }

    await db.insert(users).values({
      openId,
      email: pending.email,
      name: pending.name,
      loginMethod: "email",
      passwordHash: pending.passwordHash,
      role: pending.role as "user" | "ultra",
      plan: pending.plan as "free" | "creator" | "pro" | "agency",
      generationsLimit: pending.generationsLimit,
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(openId, {
      name: pending.name,
      expiresInMs: ONE_YEAR_MS,
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ success: true });
  });

  // ── POST /api/auth/register (kept for compatibility) ──────────────────────
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email et mot de passe requis." });
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) { res.status(400).json({ error: pwError }); return; }

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

  // ── POST /api/auth/forgot-password ───────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    if (!email) { res.status(400).json({ error: "Email requis." }); return; }

    const openId = `local:${email.toLowerCase().trim()}`;
    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const userRow = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    const code = generateOtp();

    // Only store & send if account exists (but always return success to avoid email enumeration)
    if (userRow[0]) {
      resetStore.set(openId, { code, expiresAt: Date.now() + 15 * 60 * 1000, attempts: 0 });
      try {
        await sendResetEmail(email.toLowerCase().trim(), code, userRow[0].name || email.split("@")[0]);
      } catch (err) {
        console.error("Reset email send error:", err);
      }
    }

    res.json({ sent: true });
  });

  // ── POST /api/auth/reset-password ─────────────────────────────────────────
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    const { email, code, newPassword } = req.body as { email?: string; code?: string; newPassword?: string };

    if (!email || !code || !newPassword) {
      res.status(400).json({ error: "Email, code et nouveau mot de passe requis." });
      return;
    }

    const pwError = validatePassword(newPassword);
    if (pwError) { res.status(400).json({ error: pwError }); return; }

    const openId = `local:${email.toLowerCase().trim()}`;
    const pending = resetStore.get(openId);

    if (!pending) {
      res.status(400).json({ error: "Aucune demande de réinitialisation trouvée. Recommencez." });
      return;
    }
    if (Date.now() > pending.expiresAt) {
      resetStore.delete(openId);
      res.status(400).json({ error: "Code expiré. Recommencez la procédure." });
      return;
    }

    pending.attempts++;
    if (pending.attempts > 5) {
      resetStore.delete(openId);
      res.status(429).json({ error: "Trop de tentatives. Recommencez la procédure." });
      return;
    }

    if (pending.code !== code.trim()) {
      res.status(400).json({ error: `Code incorrect. ${5 - pending.attempts} essai(s) restant(s).` });
      return;
    }

    // Code correct → update password
    resetStore.delete(openId);

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const passwordHash = storePassword(newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.openId, openId));

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
