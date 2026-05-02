import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, projects, usageLogs, versions, apiKeys } from "../../drizzle/schema";
import { desc, count, sum, eq, and, gte, sql } from "drizzle-orm";

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
      totalUsers,
      totalProjects,
      totalVersions,
      totalApiKeys,
      monthlyLogs,
      weeklyLogs,
      usersByPlan,
      recentActivity,
    ] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(projects),
      db.select({ count: count() }).from(versions),
      db.select({ count: count() }).from(apiKeys),
      db.select({ count: count(), tokens: sum(usageLogs.tokensUsed) })
        .from(usageLogs)
        .where(gte(usageLogs.createdAt, startOfMonth)),
      db.select({ count: count(), tokens: sum(usageLogs.tokensUsed) })
        .from(usageLogs)
        .where(gte(usageLogs.createdAt, startOfWeek)),
      db.select({ plan: users.plan, count: count() })
        .from(users)
        .groupBy(users.plan),
      db.select({
        id: usageLogs.id,
        userId: usageLogs.userId,
        action: usageLogs.action,
        status: usageLogs.status,
        tokensUsed: usageLogs.tokensUsed,
        createdAt: usageLogs.createdAt,
      })
        .from(usageLogs)
        .orderBy(desc(usageLogs.createdAt))
        .limit(50),
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
      onboardingDone: users.onboardingDone,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    }).from(users).orderBy(desc(users.createdAt));
  }),

  // ─── Modifier le rôle d'un utilisateur (ultra) ───────────────────────────────
  setUserRole: ultraProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(["user", "admin", "ultra"]),
    }))
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

  // ─── Réinitialiser les générations d'un utilisateur (ultra) ─────────────────
  resetUserGenerations: ultraProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(users).set({ generationsUsed: 0 }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ─── Liste de tous les projets (ultra) ───────────────────────────────────────
  getAllProjects: ultraProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: projects.id,
      name: projects.name,
      userId: projects.userId,
      status: projects.status,
      framework: projects.framework,
      isPublished: projects.isPublished,
      deployedUrl: projects.deployedUrl,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
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
