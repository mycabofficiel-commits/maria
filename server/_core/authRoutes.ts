import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users, otpCodes } from "../../drizzle/schema";
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

/* ── OTP / reset codes — persistés en DB (survivent aux redéploiements & multi-instance) ── */

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/* ── Rate-limit anti-brute-force ──────────────────────────────────────────────
 * Limiteur en mémoire par clé (IP+email). Suffisant en mono-instance (cas Render
 * actuel) ; en multi-instance chaque instance applique sa propre limite, ce qui
 * reste une protection efficace contre le bourrinage. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8; // échecs tolérés par fenêtre avant blocage
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function rateKey(req: Request, email: string): string {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim()
    || req.socket.remoteAddress || "unknown";
  return `${ip}:${email.toLowerCase().trim()}`;
}

/** Retourne le nb de secondes à attendre si bloqué, sinon 0. */
function loginRetryAfter(key: string): number {
  const rec = loginAttempts.get(key);
  if (!rec) return 0;
  if (Date.now() > rec.resetAt) { loginAttempts.delete(key); return 0; }
  if (rec.count >= LOGIN_MAX_FAILS) return Math.ceil((rec.resetAt - Date.now()) / 1000);
  return 0;
}

function recordLoginFail(key: string): void {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

function clearLoginFails(key: string): void {
  loginAttempts.delete(key);
}

// Purge périodique des entrées expirées (évite une fuite mémoire lente).
setInterval(() => {
  const now = Date.now();
  loginAttempts.forEach((v, k) => { if (now > v.resetAt) loginAttempts.delete(k); });
}, 30 * 60 * 1000).unref?.();

interface RegistrationPayload {
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  plan: string;
  generationsLimit: number;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Enregistre (ou remplace) un code pour un openId + purpose donné. */
async function saveOtpCode(
  db: Db, openId: string, purpose: "register" | "reset",
  code: string, payload: RegistrationPayload | null,
): Promise<void> {
  // Une seule demande active par (openId, purpose) : on purge l'ancienne.
  await db.delete(otpCodes).where(and(eq(otpCodes.openId, openId), eq(otpCodes.purpose, purpose)));
  await db.insert(otpCodes).values({
    openId, purpose, code,
    payload: payload ?? null,
    attempts: 0,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  // Nettoyage opportuniste des codes expirés (évite un cron dédié).
  await db.delete(otpCodes).where(lt(otpCodes.expiresAt, new Date())).catch(() => {});
}

/** Récupère le code actif pour (openId, purpose), ou null si absent/expiré. */
async function getOtpCode(db: Db, openId: string, purpose: "register" | "reset") {
  const rows = await db.select().from(otpCodes)
    .where(and(eq(otpCodes.openId, openId), eq(otpCodes.purpose, purpose)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(otpCodes).where(eq(otpCodes.id, row.id)).catch(() => {});
    return null;
  }
  return row;
}

async function incrementOtpAttempts(db: Db, id: number): Promise<void> {
  await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, id));
}

async function deleteOtpCode(db: Db, id: number): Promise<void> {
  await db.delete(otpCodes).where(eq(otpCodes.id, id)).catch(() => {});
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
    from: "Mar-ia <contact@mycabvtc.com>",
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
    from: "Mar-ia <contact@mycabvtc.com>",
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

    await saveOtpCode(db, openId, "register", code, {
      name: name || email.split("@")[0],
      email: email.toLowerCase().trim(),
      passwordHash,
      role: isOwner ? "ultra" : "user",
      plan: isOwner ? "agency" : "free",
      generationsLimit: isOwner ? 999999 : 3,
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

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const pending = await getOtpCode(db, openId, "register");
    if (!pending || !pending.payload) {
      res.status(400).json({ error: "Aucune demande d'inscription trouvée. Recommencez." });
      return;
    }

    if (pending.attempts + 1 > OTP_MAX_ATTEMPTS) {
      await deleteOtpCode(db, pending.id);
      res.status(429).json({ error: "Trop de tentatives. Recommencez l'inscription." });
      return;
    }

    if (pending.code !== code.trim()) {
      await incrementOtpAttempts(db, pending.id);
      res.status(400).json({ error: `Code incorrect. ${OTP_MAX_ATTEMPTS - (pending.attempts + 1)} essai(s) restant(s).` });
      return;
    }

    // Code correct → create account
    await deleteOtpCode(db, pending.id);
    const reg = pending.payload as unknown as RegistrationPayload;

    // Double-check no account was created in the meantime
    const existing = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    if (existing[0]) {
      res.status(409).json({ error: "Un compte existe déjà avec cet email." });
      return;
    }

    await db.insert(users).values({
      openId,
      email: reg.email,
      name: reg.name,
      loginMethod: "email",
      passwordHash: reg.passwordHash,
      role: reg.role as "user" | "ultra",
      plan: reg.plan as "free" | "creator" | "pro" | "agency",
      generationsLimit: reg.generationsLimit,
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(openId, {
      name: reg.name,
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
      await saveOtpCode(db, openId, "reset", code, null);
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

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const pending = await getOtpCode(db, openId, "reset");
    if (!pending) {
      res.status(400).json({ error: "Aucune demande de réinitialisation trouvée. Recommencez." });
      return;
    }

    if (pending.attempts + 1 > OTP_MAX_ATTEMPTS) {
      await deleteOtpCode(db, pending.id);
      res.status(429).json({ error: "Trop de tentatives. Recommencez la procédure." });
      return;
    }

    if (pending.code !== code.trim()) {
      await incrementOtpAttempts(db, pending.id);
      res.status(400).json({ error: `Code incorrect. ${OTP_MAX_ATTEMPTS - (pending.attempts + 1)} essai(s) restant(s).` });
      return;
    }

    // Code correct → update password
    await deleteOtpCode(db, pending.id);

    // Nouveau mot de passe + révocation de TOUTES les sessions existantes
    // (incrémente sessionVersion → les anciens JWT deviennent invalides).
    const passwordHash = storePassword(newPassword);
    await db.update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.openId, openId));
    // L'utilisateur ayant rate-limit éventuel repart à zéro après reset réussi.
    clearLoginFails(rateKey(req, email));

    res.json({ success: true });
  });

  // ── POST /api/auth/login ──────────────────────────────────────────────────
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email et mot de passe requis." });
      return;
    }

    const key = rateKey(req, email);
    const retryAfter = loginRetryAfter(key);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${Math.ceil(retryAfter / 60)} minute(s).` });
      return;
    }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const openId = `local:${email.toLowerCase().trim()}`;
    const userRow = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    const user = userRow[0];

    if (!user || !user.passwordHash) {
      recordLoginFail(key);
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }

    if (!verifyPassword(password, user.passwordHash)) {
      recordLoginFail(key);
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }

    clearLoginFails(key);
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.openId, openId));

    const sessionToken = await sdk.createSessionToken(openId, {
      name: user.name || email.split("@")[0],
      expiresInMs: ONE_YEAR_MS,
      sessionVersion: user.sessionVersion ?? 0,
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ success: true });
  });
}
