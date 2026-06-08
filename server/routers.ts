import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { userRouter } from "./routers/user";
import { projectsRouter } from "./routers/projects";
import { adminRouter } from "./routers/admin";
import { deployRouter } from "./routers/deploy";
import { shareRouter } from "./routers/share";
import { integrationsRouter } from "./routers/integrations";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
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
});

export type AppRouter = typeof appRouter;
