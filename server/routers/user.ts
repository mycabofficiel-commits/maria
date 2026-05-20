import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, apiKeys, projects, usageLogs } from "../../drizzle/schema";
import { eq, desc, count, sum } from "drizzle-orm";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.JWT_SECRET?.slice(0, 32).padEnd(32, "0") || "maria-default-key-32-chars-long!";

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export const userRouter = router({
  // Complete onboarding
  completeOnboarding: protectedProcedure
    .input(z.object({ plan: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const planLimits: Record<string, number> = {
        free: 3, creator: 30, pro: 100, agency: 9999,
      };
      const plan = (input.plan || "free") as "free" | "creator" | "pro" | "agency";
      await db.update(users)
        .set({
          onboardingDone: true,
          plan,
          generationsLimit: planLimits[plan] || 3,
        })
        .where(eq(users.id, ctx.user.id));
      return { success: true };
    }),

  // Get profile
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const result = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return result[0] || null;
  }),

  // Update profile
  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.update(users).set({ name: input.name }).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),

  // Get usage stats
  getUsageStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { generationsUsed: 0, generationsLimit: 3, projectsCount: 0, tokensTotal: 0 };
    const userRow = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const u = userRow[0];
    const projectsResult = await db.select({ count: count() }).from(projects).where(eq(projects.userId, ctx.user.id));
    const tokensResult = await db.select({ total: sum(usageLogs.tokensUsed) }).from(usageLogs).where(eq(usageLogs.userId, ctx.user.id));
    return {
      generationsUsed: u?.generationsUsed || 0,
      generationsLimit: u?.generationsLimit || 3,
      projectsCount: projectsResult[0]?.count || 0,
      tokensTotal: Number(tokensResult[0]?.total || 0),
      plan: u?.plan || "free",
    };
  }),

  // ─── API Keys ─────────────────────────────────────────────────────────────
  getApiKey: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const result = await db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).limit(1);
    if (!result[0]) return null;
    const { encryptedKey, ...rest } = result[0];
    return rest; // never return the encrypted key
  }),

  saveApiKey: protectedProcedure
    .input(z.object({
      key: z.string().min(10),
      model: z.string().default("claude-sonnet-4-5"),
      provider: z.string().default("anthropic"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const encrypted = encrypt(input.key);
      const hint = input.key.slice(-4);
      const existing = await db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).limit(1);
      if (existing[0]) {
        await db.update(apiKeys)
          .set({ encryptedKey: encrypted, keyHint: hint, model: input.model, provider: input.provider, status: "untested" })
          .where(eq(apiKeys.userId, ctx.user.id));
      } else {
        await db.insert(apiKeys).values({
          userId: ctx.user.id,
          encryptedKey: encrypted,
          keyHint: hint,
          model: input.model,
          provider: input.provider,
          status: "untested",
        });
      }
      return { success: true };
    }),

  deleteApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.delete(apiKeys).where(eq(apiKeys.userId, ctx.user.id));
    return { success: true };
  }),

  testApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).limit(1);
    if (!keyRow[0]) throw new Error("Aucune clé API trouvée");

    let decryptedKey: string;
    try {
      decryptedKey = decrypt(keyRow[0].encryptedKey);
    } catch {
      await db.update(apiKeys).set({ status: "invalid" }).where(eq(apiKeys.userId, ctx.user.id));
      return { valid: false, status: "invalid", errorMessage: "Clé corrompue, veuillez la re-saisir." };
    }

    const provider = keyRow[0].provider || "anthropic";

    try {
      // Provider-specific test endpoints
      let response: Response;
      if (provider === "deepseek") {
        response = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${decryptedKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: keyRow[0].model || "deepseek-chat", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }),
        });
      } else if (provider === "openai") {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${decryptedKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: keyRow[0].model || "gpt-4o-mini", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }),
        });
      } else {
        // Anthropic
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": decryptedKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }),
        });
      }

      if (response.ok) {
        // Also update model to current valid model if it was outdated
        await db.update(apiKeys)
          .set({ status: "valid", lastTestedAt: new Date(), model: keyRow[0].model === "claude-3-5-sonnet-20241022" || keyRow[0].model === "claude-3-5-haiku-20241022" ? "claude-sonnet-4-5" : keyRow[0].model })
          .where(eq(apiKeys.userId, ctx.user.id));
        return { valid: true, status: "valid", errorMessage: null };
      } else {
        const errData = await response.json().catch(() => ({})) as any;
        const errMsg = errData?.error?.message || response.statusText;
        if (response.status === 401) {
          await db.update(apiKeys).set({ status: "invalid" }).where(eq(apiKeys.userId, ctx.user.id));
          return { valid: false, status: "invalid", errorMessage: "Clé API invalide ou révoquée." };
        } else if (response.status === 429) {
          await db.update(apiKeys).set({ status: "quota_exceeded" }).where(eq(apiKeys.userId, ctx.user.id));
          return { valid: false, status: "quota_exceeded", errorMessage: "Quota Anthropic dépassé." };
        } else if (response.status === 404) {
          await db.update(apiKeys).set({ status: "invalid" }).where(eq(apiKeys.userId, ctx.user.id));
          return { valid: false, status: "invalid", errorMessage: `Modèle introuvable: ${errMsg}` };
        } else {
          await db.update(apiKeys).set({ status: "invalid" }).where(eq(apiKeys.userId, ctx.user.id));
          return { valid: false, status: "invalid", errorMessage: errMsg };
        }
      }
    } catch (e: any) {
      await db.update(apiKeys).set({ status: "invalid" }).where(eq(apiKeys.userId, ctx.user.id));
      return { valid: false, status: "invalid", errorMessage: e.message };
    }
  }),
});
