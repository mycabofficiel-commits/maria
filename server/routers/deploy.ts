import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { projects, versions } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import JSZip from "jszip";
import crypto from "crypto";

function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

function cleanSlug(name: string): string {
  return name.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "site";
}

async function ensureUniqueSlug(db: any, baseSlug: string, excludeProjectId?: number): Promise<string> {
  let slug = baseSlug;
  let i = 1;
  while (true) {
    const existing = await db.select({ id: projects.id }).from(projects)
      .where(eq(projects.slug, slug)).limit(1);
    if (!existing[0] || existing[0].id === excludeProjectId) return slug;
    slug = `${baseSlug}-${i++}`;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomSuffix(): string {
  return crypto.randomBytes(4).toString("hex");
}

/** Extracts <title> from HTML, falls back to project name */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || "Site généré par Maria";
}

/** Splits a single-file HTML into index.html + style.css + script.js */
function splitHtmlIntoFiles(html: string): Record<string, string> {
  // Extract <style> blocks
  const styleMatches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  const cssContent = styleMatches.map((m) => m[1]).join("\n\n");

  // Extract <script> blocks (no src attribute)
  const scriptMatches = Array.from(html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi));
  const jsContent = scriptMatches.map((m) => m[1]).join("\n\n");

  // Clean HTML: remove inline style/script, link external files
  let cleanHtml = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace("</head>", `  <link rel="stylesheet" href="style.css">\n</head>`)
    .replace("</body>", `  <script src="script.js"></script>\n</body>`);

  return {
    "index.html": cleanHtml,
    "style.css": cssContent || "/* Styles */",
    "script.js": jsContent || "// Scripts",
    "README.md": `# Site généré par Maria\n\nCe site a été généré par [Maria](https://maria.app) — AI Website Builder.\n\n## Structure\n\n- \`index.html\` — Page principale\n- \`style.css\` — Styles CSS\n- \`script.js\` — Scripts JavaScript\n\n## Utilisation\n\nOuvrez \`index.html\` dans votre navigateur ou déployez sur n'importe quel hébergeur statique.\n`,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const deployRouter = router({

  // ── Export ZIP ────────────────────────────────────────────────────────────
  exportZip: protectedProcedure
    .input(z.object({ projectId: z.number(), versionId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify ownership
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Projet introuvable" });

      // Get version
      const versionId = input.versionId || project[0].currentVersionId;
      if (!versionId) throw new TRPCError({ code: "BAD_REQUEST", message: "Aucune version générée" });

      const version = await db.select().from(versions)
        .where(eq(versions.id, versionId)).limit(1);
      if (!version[0]?.generatedCode) throw new TRPCError({ code: "NOT_FOUND", message: "Version introuvable" });

      // Build ZIP
      const zip = new JSZip();
      const files = splitHtmlIntoFiles(version[0].generatedCode);
      for (const [filename, content] of Object.entries(files)) {
        zip.file(filename, content);
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

      // Upload to S3
      const slug = project[0].slug || `project-${input.projectId}`;
      const key = `exports/${ctx.user.id}/${slug}-v${version[0].versionNumber}-${randomSuffix()}.zip`;
      const { url } = await storagePut(key, zipBuffer, "application/zip");

      return { url, filename: `${slug}-v${version[0].versionNumber}.zip` };
    }),

  // ── Import code ───────────────────────────────────────────────────────────
  importCode: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      htmlContent: z.string().min(1),
      label: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify ownership
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Projet introuvable" });

      // Get next version number
      const existingVersions = await db.select().from(versions)
        .where(eq(versions.projectId, input.projectId))
        .orderBy(desc(versions.versionNumber))
        .limit(1);
      const nextVersionNumber = (existingVersions[0]?.versionNumber || 0) + 1;

      // Create new version with imported code
      const [result] = await db.insert(versions).values({
        projectId: input.projectId,
        userId: ctx.user.id,
        versionNumber: nextVersionNumber,
        label: input.label || `Import v${nextVersionNumber}`,
        prompt: "Code importé manuellement",
        generatedCode: input.htmlContent,
        tokensUsed: 0,
        model: "manual-import",
        status: "ready",
      }).returning({ id: versions.id });
      const versionId = result.id;

      // Update project
      await db.update(projects).set({
        currentVersionId: versionId,
        status: "ready",
      }).where(eq(projects.id, input.projectId));

      return { versionId, versionNumber: nextVersionNumber };
    }),

  // ── Update slug ───────────────────────────────────────────────────────────
  updateSlug: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Slug invalide : lettres, chiffres et tirets uniquement"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Projet introuvable" });

      const uniqueSlug = await ensureUniqueSlug(db, input.slug, input.projectId);
      const baseUrl = getAppBaseUrl().replace(/\/$/, "");
      const deployedUrl = project[0].isPublished ? `${baseUrl}/p/${uniqueSlug}` : project[0].deployedUrl;

      await db.update(projects).set({
        slug: uniqueSlug,
        ...(project[0].isPublished ? { deployedUrl } : {}),
      }).where(eq(projects.id, input.projectId));

      return { slug: uniqueSlug, deployedUrl };
    }),

  // ── Deploy (DB-hosted, served via /p/:slug) ───────────────────────────────
  deploy: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      versionId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify ownership
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Projet introuvable" });

      const versionId = input.versionId || project[0].currentVersionId;
      if (!versionId) throw new TRPCError({ code: "BAD_REQUEST", message: "Aucune version à déployer" });

      const version = await db.select().from(versions)
        .where(eq(versions.id, versionId)).limit(1);
      if (!version[0]?.generatedCode) throw new TRPCError({ code: "NOT_FOUND", message: "Version introuvable" });

      // Use clean slug (no random suffix)
      const currentSlug = project[0].slug || "";
      const hasRandomSuffix = /^.+-[a-z0-9]{4,6}$/.test(currentSlug);
      let slug = currentSlug;
      if (!slug || hasRandomSuffix) {
        const base = cleanSlug(project[0].name || `project-${input.projectId}`);
        slug = await ensureUniqueSlug(db, base, input.projectId);
        await db.update(projects).set({ slug }).where(eq(projects.id, input.projectId));
      }

      const baseUrl = getAppBaseUrl().replace(/\/$/, "");
      const deployedUrl = `${baseUrl}/p/${slug}`;

      // Update project — HTML is served from DB via /p/:slug
      await db.update(projects).set({
        deployedUrl,
        deployedAt: new Date(),
        deployedVersionId: versionId,
        isPublished: true,
        status: "published",
        publishedAt: new Date(),
      }).where(eq(projects.id, input.projectId));

      return { deployedUrl, slug };
    }),

  // ── Get deploy info ───────────────────────────────────────────────────────
  getDeployInfo: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const result = await db.select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        deployedUrl: projects.deployedUrl,
        deployedAt: projects.deployedAt,
        deployedVersionId: projects.deployedVersionId,
        isPublished: projects.isPublished,
        status: projects.status,
        currentVersionId: projects.currentVersionId,
      }).from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      return result[0] || null;
    }),
});
