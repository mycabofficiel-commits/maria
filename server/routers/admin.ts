import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, projects, usageLogs, versions, apiKeys, platformApiKeys } from "../../drizzle/schema";
import { desc, count, sum, eq, and, gte, sql } from "drizzle-orm";
import crypto from "crypto";

// ── Encryption helpers (same key as streaming.ts) ─────────────────────────────
const ENCRYPTION_KEY =
  process.env.JWT_SECRET?.slice(0, 32).padEnd(32, "0") ||
  "maria-default-key-32-chars-long!";

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  return `${iv.toString("hex")}:${enc}`;
}

function decrypt(encryptedText: string): string {
  const [ivHex, enc] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// ── Role guards ───────────────────────────────────────────────────────────────

// Admin procedure — accessible aux rôles admin ET ultra
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "ultra") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

// Ultra procedure — accessible uniquement au rôle ultra
const ultraProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ultra") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Accès réservé au compte Ultra." });
  }
  return next({ ctx });
});

export const adminRouter = router({
  // ─── Stats générales (admin + ultra) ────────────────────────────────────────
  getStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalUsers: 0, totalProjects: 0, totalGenerations: 0, totalTokens: 0 };

    const [usersResult, projectsResult, logsResult] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(projects),
      db.select({ totalGenerations: count(), totalTokens: sum(usageLogs.tokensUsed) }).from(usageLogs),
    ]);

    return {
      totalUsers: usersResult[0]?.count || 0,
      totalProjects: projectsResult[0]?.count || 0,
      totalGenerations: logsResult[0]?.totalGenerations || 0,
      totalTokens: Number(logsResult[0]?.totalTokens || 0),
    };
  }),

  getRecentUsers: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(users).orderBy(desc(users.createdAt)).limit(20);
  }),

  // ─── Stats Ultra étendues ────────────────────────────────────────────────────
  getUltraStats: ultraProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, totalProjects, totalVersions, totalApiKeys,
      monthlyLogs, weeklyLogs, usersByPlan, recentActivity,
    ] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(projects),
      db.select({ count: count() }).from(versions),
      db.select({ count: count() }).from(apiKeys),
      db.select({ count: count(), tokens: sum(usageLogs.tokensUsed) })
        .from(usageLogs).where(gte(usageLogs.createdAt, startOfMonth)),
      db.select({ count: count(), tokens: sum(usageLogs.tokensUsed) })
        .from(usageLogs).where(gte(usageLogs.createdAt, startOfWeek)),
      db.select({ plan: users.plan, count: count() }).from(users).groupBy(users.plan),
      db.select({
        id: usageLogs.id, userId: usageLogs.userId,
        action: usageLogs.action, status: usageLogs.status,
        tokensUsed: usageLogs.tokensUsed, createdAt: usageLogs.createdAt,
      }).from(usageLogs).orderBy(desc(usageLogs.createdAt)).limit(50),
    ]);

    return {
      totals: {
        users: totalUsers[0]?.count || 0,
        projects: totalProjects[0]?.count || 0,
        versions: totalVersions[0]?.count || 0,
        apiKeys: totalApiKeys[0]?.count || 0,
      },
      monthly: {
        generations: monthlyLogs[0]?.count || 0,
        tokens: Number(monthlyLogs[0]?.tokens || 0),
      },
      weekly: {
        generations: weeklyLogs[0]?.count || 0,
        tokens: Number(weeklyLogs[0]?.tokens || 0),
      },
      usersByPlan,
      recentActivity,
    };
  }),

  // ─── Liste complète des utilisateurs (ultra) ─────────────────────────────────
  getAllUsers: ultraProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      plan: users.plan,
      generationsUsed: users.generationsUsed,
      generationsLimit: users.generationsLimit,
      monthlyTokensLimit: users.monthlyTokensLimit,
      onboardingDone: users.onboardingDone,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    }).from(users).orderBy(desc(users.createdAt));
  }),

  // ─── Stats tokens par utilisateur (ultra) ────────────────────────────────────
  getUserTokenStats: ultraProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allTime, thisMonth] = await Promise.all([
      db.select({
        userId: usageLogs.userId,
        totalTokens: sum(usageLogs.tokensUsed),
        totalCostUsd: sum(usageLogs.costEstimateUsd),
      }).from(usageLogs).groupBy(usageLogs.userId),
      db.select({
        userId: usageLogs.userId,
        monthTokens: sum(usageLogs.tokensUsed),
      }).from(usageLogs)
        .where(gte(usageLogs.createdAt, startOfMonth))
        .groupBy(usageLogs.userId),
    ]);

    const monthMap = new Map(thisMonth.map(r => [r.userId, Number(r.monthTokens || 0)]));
    return allTime.map(r => ({
      userId: r.userId,
      totalTokens: Number(r.totalTokens || 0),
      totalCostUsd: Number(r.totalCostUsd || 0),
      monthTokens: monthMap.get(r.userId) || 0,
    }));
  }),

  // ─── Modifier le rôle d'un utilisateur (ultra) ───────────────────────────────
  setUserRole: ultraProcedure
    .input(z.object({ userId: z.number(), role: z.enum(["user", "admin", "ultra"]) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ─── Modifier le plan d'un utilisateur (ultra) ───────────────────────────────
  setUserPlan: ultraProcedure
    .input(z.object({
      userId: z.number(),
      plan: z.enum(["free", "creator", "pro", "agency"]),
      generationsLimit: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const limits: Record<string, number> = { free: 3, creator: 30, pro: 100, agency: 500 };
      const newLimit = input.generationsLimit ?? limits[input.plan] ?? 3;
      await db.update(users)
        .set({ plan: input.plan, generationsLimit: newLimit })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ─── Modifier la limite mensuelle de tokens (ultra) ──────────────────────────
  setUserTokenLimit: ultraProcedure
    .input(z.object({
      userId: z.number(),
      monthlyTokensLimit: z.number().min(0).nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users)
        .set({ monthlyTokensLimit: input.monthlyTokensLimit })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ─── Réinitialiser les générations d'un utilisateur (ultra) ─────────────────
  resetUserGenerations: ultraProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ generationsUsed: 0 }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ─── Clés LLM plateforme — lister (ultra) ────────────────────────────────────
  getPlatformKeys: ultraProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: platformApiKeys.id,
      provider: platformApiKeys.provider,
      keyHint: platformApiKeys.keyHint,
      label: platformApiKeys.label,
      isActive: platformApiKeys.isActive,
      updatedAt: platformApiKeys.updatedAt,
    }).from(platformApiKeys).orderBy(platformApiKeys.provider);
  }),

  // ─── Clés LLM plateforme — ajouter / mettre à jour (ultra) ──────────────────
  setPlatformKey: ultraProcedure
    .input(z.object({
      provider: z.enum(["anthropic", "openai", "deepseek", "qwen"]),
      rawKey: z.string().min(8, "Clé trop courte"),
      label: z.string().max(64).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const encryptedKey = encrypt(input.rawKey);
      const keyHint = `…${input.rawKey.slice(-4)}`;
      await db.insert(platformApiKeys)
        .values({
          provider: input.provider,
          encryptedKey,
          keyHint,
          label: input.label || null,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: platformApiKeys.provider,
          set: { encryptedKey, keyHint, label: input.label || null, isActive: true, updatedAt: new Date() },
        });
      return { success: true };
    }),

  // ─── Clés LLM plateforme — activer / désactiver (ultra) ──────────────────────
  togglePlatformKey: ultraProcedure
    .input(z.object({
      provider: z.enum(["anthropic", "openai", "deepseek", "qwen"]),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(platformApiKeys)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(platformApiKeys.provider, input.provider));
      return { success: true };
    }),

  // ─── Clés LLM plateforme — supprimer (ultra) ─────────────────────────────────
  deletePlatformKey: ultraProcedure
    .input(z.object({ provider: z.enum(["anthropic", "openai", "deepseek", "qwen"]) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(platformApiKeys).where(eq(platformApiKeys.provider, input.provider));
      return { success: true };
    }),

  // ─── Liste de tous les projets (ultra) ───────────────────────────────────────
  getAllProjects: ultraProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: projects.id, name: projects.name, userId: projects.userId,
      status: projects.status, framework: projects.framework,
      isPublished: projects.isPublished, deployedUrl: projects.deployedUrl,
      createdAt: projects.createdAt, updatedAt: projects.updatedAt,
    }).from(projects).orderBy(desc(projects.createdAt)).limit(200);
  }),

  // ─── Supprimer un projet (ultra) ─────────────────────────────────────────────
  deleteProject: ultraProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(projects).where(eq(projects.id, input.projectId));
      return { success: true };
    }),
});
