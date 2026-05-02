import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 99,
    openId: "test-user-deploy",
    email: "deploy@test.com",
    name: "Deploy Tester",
    loginMethod: "manus",
    role: "user",
    plan: "pro",
    onboardingDone: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    generationsUsed: 0,
    generationsLimit: 100,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

// ─── Deploy router tests ──────────────────────────────────────────────────────
describe("deploy.getDeployInfo", () => {
  it("requires authentication", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(caller.deploy.getDeployInfo({ projectId: 1 })).rejects.toThrow();
  });

  it("returns null for non-existent project (no DB in test env)", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    // Without DB, should return null gracefully
    const result = await caller.deploy.getDeployInfo({ projectId: 999999 });
    expect(result).toBeNull();
  });
});

describe("deploy.importCode", () => {
  it("requires authentication", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.deploy.importCode({ projectId: 1, htmlContent: "<html></html>" })
    ).rejects.toThrow();
  });

  it("validates that htmlContent is required", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.deploy.importCode({ projectId: 1, htmlContent: "" })
    ).rejects.toThrow();
  });
});

describe("deploy.exportZip", () => {
  it("requires authentication", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.deploy.exportZip({ projectId: 1 })
    ).rejects.toThrow();
  });
});

describe("deploy.deploy", () => {
  it("requires authentication", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: () => {} } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.deploy.deploy({ projectId: 1 })
    ).rejects.toThrow();
  });
});
