import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userIntegrations } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

const ENCRYPTION_KEY =
  process.env.JWT_SECRET?.slice(0, 32).padEnd(32, "0") ||
  "maria-default-key-32-chars-long!";

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  return iv.toString("hex") + ":" + enc;
}

function decrypt(encryptedText: string): string {
  const [ivHex, enc] = encryptedText.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    Buffer.from(ivHex, "hex")
  );
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 6) + "****" + key.slice(-4);
}

export const integrationsRouter = router({
  // Save (create or update) an integration key
  save: protectedProcedure
    .input(
      z.object({
        apiName: z.string().min(1).max(64),
        apiLabel: z.string().min(1).max(128),
        key: z.string().min(1),
        projectId: z.number().optional(),
        baseUrl: z.string().url().optional(),
        docUrl: z.string().url().optional(),
        docSummary: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const encryptedKey = encrypt(input.key);
      const keyHint = maskKey(input.key);

      // Upsert: update existing row for same userId+apiName+projectId, else insert
      const existing = await db
        .select({ id: userIntegrations.id })
        .from(userIntegrations)
        .where(
          and(
            eq(userIntegrations.userId, ctx.user.id),
            eq(userIntegrations.apiName, input.apiName.toLowerCase()),
            input.projectId
              ? eq(userIntegrations.projectId, input.projectId)
              : eq(userIntegrations.projectId, 0) // 0 = no projectId stored as int
          )
        )
        .limit(1);

      if (existing[0]) {
        await db
          .update(userIntegrations)
          .set({
            encryptedKey,
            keyHint,
            apiLabel: input.apiLabel,
            baseUrl: input.baseUrl ?? null,
            docUrl: input.docUrl ?? null,
            docSummary: input.docSummary ?? null,
            updatedAt: new Date(),
          })
          .where(eq(userIntegrations.id, existing[0].id));
        return { id: existing[0].id, updated: true };
      }

      const [row] = await db
        .insert(userIntegrations)
        .values({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          apiName: input.apiName.toLowerCase(),
          apiLabel: input.apiLabel,
          encryptedKey,
          keyHint,
          baseUrl: input.baseUrl ?? null,
          docUrl: input.docUrl ?? null,
          docSummary: input.docSummary ?? null,
        })
        .returning({ id: userIntegrations.id });

      return { id: row.id, updated: false };
    }),

  // List integrations (keys masked)
  list: protectedProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const rows = await db
        .select({
          id: userIntegrations.id,
          apiName: userIntegrations.apiName,
          apiLabel: userIntegrations.apiLabel,
          keyHint: userIntegrations.keyHint,
          baseUrl: userIntegrations.baseUrl,
          docUrl: userIntegrations.docUrl,
          docSummary: userIntegrations.docSummary,
          projectId: userIntegrations.projectId,
          createdAt: userIntegrations.createdAt,
          updatedAt: userIntegrations.updatedAt,
        })
        .from(userIntegrations)
        .where(eq(userIntegrations.userId, ctx.user.id));

      // If projectId given, return project-specific + global ones
      if (input.projectId) {
        return rows.filter(
          (r) => r.projectId === input.projectId || r.projectId === null
        );
      }
      return rows;
    }),

  // Delete an integration
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .delete(userIntegrations)
        .where(
          and(
            eq(userIntegrations.id, input.id),
            eq(userIntegrations.userId, ctx.user.id)
          )
        );
      return { success: true };
    }),

  // Expose decrypted key to server-side use (used by proxy)
  // Not exposed to client directly — only used internally
  _getDecrypted: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .select()
        .from(userIntegrations)
        .where(
          and(
            eq(userIntegrations.id, input.id),
            eq(userIntegrations.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!row) throw new Error("Integration introuvable");
      return {
        ...row,
        key: decrypt(row.encryptedKey),
      };
    }),
});

// Helper used by streaming.ts (server-side only)
export async function getIntegrationKey(
  userId: number,
  apiName: string,
  projectId?: number
): Promise<{ key: string; baseUrl: string | null; docSummary: string | null } | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.apiName, apiName.toLowerCase())
      )
    );

  // Prefer project-specific, fall back to global
  const row =
    rows.find((r) => r.projectId === projectId) ??
    rows.find((r) => r.projectId === null) ??
    rows[0];

  if (!row) return null;
  try {
    return {
      key: decrypt(row.encryptedKey),
      baseUrl: row.baseUrl,
      docSummary: row.docSummary,
    };
  } catch {
    return null;
  }
}
