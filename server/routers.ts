import { COOKIE_NAME } from "@shared/const";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { userRouter } from "./routers/user";
import { projectsRouter } from "./routers/projects";
import { adminRouter } from "./routers/admin";
import { deployRouter } from "./routers/deploy";
import { shareRouter } from "./routers/share";
import { integrationsRouter } from "./routers/integrations";
import { billingRouter } from "./routers/billing";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // Déconnexion globale : invalide TOUTES les sessions de l'utilisateur sur
    // tous ses appareils (incrémente sessionVersion → anciens JWT rejetés).
    logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (db) {
        await db.update(users)
          .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
          .where(eq(users.id, ctx.user.id));
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    completeOnboarding: userRouter.completeOnboarding,
  }),

  user: userRouter,
  projects: projectsRouter,
  admin: adminRouter,
  deploy: deployRouter,
  share: shareRouter,
  integrations: integrationsRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;
