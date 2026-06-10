import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStreamingRoutes } from "../streaming";
import { registerAuthRoutes } from "./authRoutes";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

function adminHashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function runMigrations() {
  try {
    const db = await getDb();
    if (db) {
      await migrate(db, { migrationsFolder: "./drizzle/pg" });
      console.log("[DB] Migrations applied successfully");
    }
  } catch (err) {
    console.warn("[DB] Migration warning:", err);
  }
}

/**
 * Safety net: applique les colonnes/tables manquantes directement en SQL,
 * indépendamment du système de migrations Drizzle.
 * Idempotent — IF NOT EXISTS partout.
 */
async function ensureSchema() {
  try {
    const db = await getDb();
    if (!db) return;

    // Table platform_api_keys (clés LLM admin)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "platform_api_keys" (
        "id"           serial PRIMARY KEY NOT NULL,
        "provider"     varchar(32) NOT NULL,
        "encryptedKey" text NOT NULL,
        "keyHint"      varchar(16),
        "label"        varchar(64),
        "isActive"     boolean NOT NULL DEFAULT true,
        "createdAt"    timestamp NOT NULL DEFAULT now(),
        "updatedAt"    timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "platform_api_keys_provider_unique" UNIQUE("provider")
      )
    `);

    // Colonne monthlyTokensLimit sur users
    await db.execute(sql`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthlyTokensLimit" integer
    `);

    // Valeur "expo" dans l'enum framework (PostgreSQL 12+ supporte ADD VALUE IF NOT EXISTS)
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TYPE "framework" ADD VALUE IF NOT EXISTS 'expo';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Table user_integrations (clés API tiers chiffrées par utilisateur/projet)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user_integrations" (
        "id"           serial PRIMARY KEY NOT NULL,
        "userId"       integer NOT NULL,
        "projectId"    integer,
        "apiName"      varchar(64) NOT NULL,
        "apiLabel"     varchar(128) NOT NULL,
        "encryptedKey" text NOT NULL,
        "keyHint"      varchar(20),
        "baseUrl"      varchar(512),
        "docUrl"       text,
        "docSummary"   text,
        "createdAt"    timestamp NOT NULL DEFAULT now(),
        "updatedAt"    timestamp NOT NULL DEFAULT now()
      )
    `);

    console.log("[DB] Schema patch OK");
  } catch (err) {
    console.warn("[DB] ensureSchema warning:", err);
  }
}

async function startServer() {
  await runMigrations();
  await ensureSchema();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Health check for Render
  app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

  // One-time admin account creation — accepts JWT_SECRET or fallback "maria-admin-init"
  app.get("/api/admin/init", async (req, res) => {
    const secret = req.query.secret as string;
    const jwtSecret = process.env.JWT_SECRET || process.env.COOKIE_SECRET || "";
    const fallbackSecret = "maria-admin-init";
    if (!secret || (secret !== jwtSecret && secret !== fallbackSecret)) {
      return res.status(401).json({ error: "Invalid secret", hint: "Use ?secret=maria-admin-init" });
    }
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB unavailable" });
      const adminOpenId = "local:mycab.officiel@gmail.com";
      const adminPasswordHash = adminHashPassword("123456789!");
      const existing = await db.select().from(users).where(eq(users.email, "mycab.officiel@gmail.com")).limit(1);
      if (existing[0]) {
        await db.update(users)
          .set({ openId: adminOpenId, role: "ultra", plan: "agency", generationsLimit: 9999, passwordHash: adminPasswordHash, onboardingDone: true, loginMethod: "email" })
          .where(eq(users.email, "mycab.officiel@gmail.com"));
        return res.json({ success: true, action: "updated", email: "mycab.officiel@gmail.com", role: "ultra" });
      }
      await db.insert(users).values({
        openId: adminOpenId,
        name: "Admin",
        email: "mycab.officiel@gmail.com",
        loginMethod: "email",
        role: "ultra",
        plan: "agency",
        generationsLimit: 9999,
        passwordHash: adminPasswordHash,
        onboardingDone: true,
      });
      return res.json({ success: true, action: "created", email: "mycab.officiel@gmail.com", role: "ultra" });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Email/password auth routes
  registerAuthRoutes(app);

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Stripe webhook — needs raw body BEFORE express.json() parses it
  // We register it here with express.raw() so the signature check works
  {
    const { registerBillingRoutes } = await import("../routers/billing");
    app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
    registerBillingRoutes(app);
  }

  // ── Public site hosting: /p/:slug ──────────────────────────────────────────
  app.get("/p/:slug", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(503).send("Service unavailable");
      const { projects, versions } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const project = await db.select().from(projects)
        .where(and(eq(projects.slug, req.params.slug), eq(projects.isPublished, true)))
        .limit(1);
      if (!project[0]) return res.status(404).send("<!DOCTYPE html><html><body><h2>Site introuvable</h2><p>Ce site n'existe pas ou n'est pas publié.</p></body></html>");
      const versionId = project[0].deployedVersionId || project[0].currentVersionId;
      if (!versionId) return res.status(404).send("Aucune version déployée");
      const version = await db.select().from(versions).where(eq(versions.id, versionId)).limit(1);
      if (!version[0]?.generatedCode) return res.status(404).send("Version introuvable");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.send(version[0].generatedCode);
    } catch (e: any) {
      return res.status(500).send("Erreur serveur");
    }
  });
  // Streaming SSE routes (Claude real-time)
  registerStreamingRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
