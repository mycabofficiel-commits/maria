import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { projects, versions, chatMessages, projectFiles, usageLogs, users, apiKeys } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.JWT_SECRET?.slice(0, 32).padEnd(32, "0") || "maria-default-key-32-chars-long!";

function decrypt(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 7);
}

export const projectsRouter = router({
  // List projects
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(projects)
      .where(eq(projects.userId, ctx.user.id))
      .orderBy(desc(projects.updatedAt));
  }),

  // Get single project
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const result = await db.select().from(projects)
        .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!result[0]) throw new Error("Projet introuvable");
      return result[0];
    }),

  // Create project
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      siteType: z.string().optional(),
      style: z.string().optional(),
      language: z.string().default("fr"),
      colorPalette: z.string().optional(),
      framework: z.enum(["html", "react", "nextjs"]).default("html"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // Check plan limits
      const userRow = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const u = userRow[0];
      const planLimits: Record<string, number> = { free: 1, creator: 5, pro: 20, agency: 9999 };
      const limit = planLimits[u?.plan || "free"] || 1;
      const projectCount = await db.select({ count: count() }).from(projects).where(eq(projects.userId, ctx.user.id));
      if ((projectCount[0]?.count || 0) >= limit) {
        throw new Error(`Limite de projets atteinte pour votre plan (${limit}). Passez à un plan supérieur.`);
      }
      const [result] = await db.insert(projects).values({
        userId: ctx.user.id,
        name: input.name,
        slug: slugify(input.name),
        description: input.description,
        siteType: input.siteType,
        style: input.style,
        language: input.language,
        colorPalette: input.colorPalette,
        framework: input.framework,
        status: "draft",
      });
      return { id: (result as any).insertId };
    }),

  // Update project
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
      customDomain: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const { id, ...data } = input;
      await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.userId, ctx.user.id)));
      return { success: true };
    }),

  // Delete project
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.delete(projects).where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)));
      return { success: true };
    }),

  // Generate site with AI
  generate: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      prompt: z.string().min(1),
      siteType: z.string().optional(),
      style: z.string().optional(),
      language: z.string().default("fr"),
      colorPalette: z.string().optional(),
      framework: z.enum(["html", "react", "nextjs"]).default("html"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Check generations limit
      const userRow = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const u = userRow[0];
      if ((u?.generationsUsed || 0) >= (u?.generationsLimit || 3)) {
        throw new Error("Limite de générations atteinte pour ce mois. Passez à un plan supérieur.");
      }

      // Get API key
      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).limit(1);
      if (!keyRow[0]) throw new Error("Aucune clé API Anthropic configurée. Rendez-vous dans Clés API.");

      let apiKey: string;
      try {
        apiKey = decrypt(keyRow[0].encryptedKey);
      } catch {
        throw new Error("Clé API invalide ou corrompue.");
      }

      // Get current version count
      const versionCount = await db.select({ count: count() }).from(versions)
        .where(eq(versions.projectId, input.projectId));
      const versionNumber = (versionCount[0]?.count || 0) + 1;

      // Update project status
      await db.update(projects).set({ status: "generating" }).where(eq(projects.id, input.projectId));

      const startTime = Date.now();

      // Fallback: if model is outdated, use the latest working model
      const modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
        ? "claude-sonnet-4-5"
        : keyRow[0].model;

      const systemPrompt = `Tu es un expert en développement web. Tu génères du code HTML/CSS/JS de haute qualité, professionnel, responsive et optimisé SEO.

RÈGLES IMPORTANTES:
- Génère UNIQUEMENT du code HTML complet (<!DOCTYPE html> ... </html>)
- Le CSS doit être intégré dans une balise <style> dans le <head>
- Le JS doit être intégré dans une balise <script> avant </body>
- Utilise des polices Google Fonts via CDN
- Le design doit être moderne, professionnel et responsive
- Inclus des meta tags SEO (title, description, OG)
- Utilise des couleurs cohérentes et un design premium
- Crée plusieurs sections bien structurées
- N'utilise PAS de frameworks externes (pas de React, Vue, etc.)
- Le code doit être complet et fonctionnel immédiatement

TYPE DE SITE: ${input.siteType || "landing page"}
STYLE: ${input.style || "moderne"}
LANGUE: ${input.language}
PALETTE: ${input.colorPalette || "bleu/violet moderne"}`;

      const userMessage = `Crée un site web complet pour: ${input.prompt}

Génère un code HTML/CSS/JS complet, professionnel et prêt à l'emploi. Inclus:
- Un header avec navigation
- Un hero section accrocheur
- Des sections de contenu pertinentes
- Un footer
- Des animations CSS subtiles
- Un design responsive mobile-first
- Les meta tags SEO appropriés

Retourne UNIQUEMENT le code HTML complet, sans explication, sans markdown, sans backticks.`;

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: modelToUse,
            max_tokens: 8000,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          await db.update(projects).set({ status: "error" }).where(eq(projects.id, input.projectId));
          throw new Error(`Erreur API Anthropic: ${(err as any).error?.message || response.statusText}`);
        }

        const data = await response.json() as any;
        const generatedCode = data.content?.[0]?.text || "";
        const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
        const durationMs = Date.now() - startTime;

        // Save version
        const [versionResult] = await db.insert(versions).values({
          projectId: input.projectId,
          userId: ctx.user.id,
          versionNumber,
          label: `Version ${versionNumber}`,
          prompt: input.prompt,
          generatedCode,
          tokensUsed,
          generationTimeMs: durationMs,
          model: modelToUse,
          status: "ready",
        });
        const versionId = (versionResult as any).insertId;

        // Update project
        await db.update(projects).set({
          status: "ready",
          currentVersionId: versionId,
          siteType: input.siteType,
          style: input.style,
          language: input.language,
          colorPalette: input.colorPalette,
        }).where(eq(projects.id, input.projectId));

        // Increment usage
        await db.update(users).set({ generationsUsed: (u?.generationsUsed || 0) + 1 }).where(eq(users.id, ctx.user.id));

        // Log usage
        await db.insert(usageLogs).values({
          userId: ctx.user.id,
          projectId: input.projectId,
          action: "generate",
          model: keyRow[0].model,
          tokensUsed,
          durationMs,
          status: "success",
        });

        return { versionId, generatedCode, tokensUsed, durationMs };
      } catch (error: any) {
        await db.update(projects).set({ status: "error" }).where(eq(projects.id, input.projectId));
        await db.insert(usageLogs).values({
          userId: ctx.user.id,
          projectId: input.projectId,
          action: "generate",
          status: "error",
          errorMessage: error.message,
        });
        throw error;
      }
    }),

  // Chat edit
  chatEdit: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      message: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Get current version
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new Error("Projet introuvable");

      const currentVersion = await db.select().from(versions)
        .where(eq(versions.id, project[0].currentVersionId!))
        .limit(1);
      if (!currentVersion[0]) throw new Error("Aucune version générée");

      // Get API key
      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).limit(1);
      if (!keyRow[0]) throw new Error("Aucune clé API Anthropic configurée");
      const apiKey = decrypt(keyRow[0].encryptedKey);

      // Fallback: if model is outdated, use the latest working model
      const modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
        ? "claude-sonnet-4-5"
        : keyRow[0].model;

      // Save user message
      await db.insert(chatMessages).values({
        projectId: input.projectId,
        userId: ctx.user.id,
        role: "user",
        content: input.message,
      });

      // Get full chat history (last 20 messages for memory)
      const history = await db.select().from(chatMessages)
        .where(eq(chatMessages.projectId, input.projectId))
        .orderBy(chatMessages.createdAt)
        .limit(20);

      const versionCount = await db.select({ count: count() }).from(versions)
        .where(eq(versions.projectId, input.projectId));
      const totalVersions = versionCount[0]?.count || 0;

      const startTime = Date.now();

      // Agent system prompt — Maria knows the project, remembers conversations, decides to modify or just chat
      const systemPrompt = `Tu es Maria, une IA experte en création de sites web. Tu es l'assistante personnelle de l'utilisateur pour ce projet web.

CONTEXTE DU PROJET:
- Nom du projet: ${project[0].name}
- Description: ${project[0].description || "Non définie"}
- Nombre de versions créées: ${totalVersions}
- Code actuel du site (HTML complet):
${currentVersion[0].generatedCode?.slice(0, 3000)}${(currentVersion[0].generatedCode?.length || 0) > 3000 ? "\n... (code tronqué)" : ""}

TU PEUX FAIRE DEUX CHOSES:
1. MODIFIER LE SITE: Si l'utilisateur demande une modification du site (changer couleur, ajouter section, modifier texte, etc.), réponds avec le JSON suivant EXACTEMENT:
{"action":"modify","code":"<html complet modifié>","reply":"Explication courte de ce que tu as fait"}

2. RÉPONDRE EN CONVERSATION: Si l'utilisateur pose une question, veut discuter, demande un conseil, ou ne demande PAS de modification du code, réponds avec:
{"action":"chat","reply":"Ta réponse naturelle et utile"}

RÈGLES IMPORTANTES:
- Tu te souviens de TOUTE la conversation précédente
- Tu es chaleureuse, professionnelle et proactive
- Pour les modifications, le code doit être complet et fonctionnel
- Réponds TOUJOURS en JSON valide, rien d'autre
- Réponds dans la langue de l'utilisateur`;

      // Build conversation history for the LLM
      const llmMessages = history
        .filter(m => m.content && m.content.trim())
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.role === "assistant"
            ? (m.content || "")
            : m.content || "",
        }));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelToUse,
          max_tokens: 8000,
          system: systemPrompt,
          messages: llmMessages,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erreur API: ${errText}`);
      }

      const data = await response.json() as any;
      const rawReply = data.content?.[0]?.text || "{}";
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
      const durationMs = Date.now() - startTime;

      // Parse agent response
      let agentResponse: { action: string; code?: string; reply: string };
      try {
        // Extract JSON from response (sometimes wrapped in ```json)
        const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
        agentResponse = JSON.parse(jsonMatch ? jsonMatch[0] : rawReply);
      } catch {
        // Fallback: treat as chat reply
        agentResponse = { action: "chat", reply: rawReply };
      }

      let versionId: number | null = null;
      let newCode: string | null = null;

      if (agentResponse.action === "modify" && agentResponse.code) {
        // Create new version
        const nextVersionNumber = totalVersions + 1;
        newCode = agentResponse.code;
        const [versionResult] = await db.insert(versions).values({
          projectId: input.projectId,
          userId: ctx.user.id,
          versionNumber: nextVersionNumber,
          label: `Version ${nextVersionNumber} — ${input.message.slice(0, 50)}`,
          prompt: input.message,
          generatedCode: newCode,
          tokensUsed,
          generationTimeMs: durationMs,
          model: modelToUse,
          status: "ready",
        });
        versionId = (versionResult as any).insertId;
        await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, input.projectId));
      }

      // Save assistant reply (the natural language reply, not the code)
      const assistantReply = agentResponse.reply || "Je suis là pour vous aider !";
      await db.insert(chatMessages).values({
        projectId: input.projectId,
        userId: ctx.user.id,
        role: "assistant",
        content: assistantReply,
        versionId: versionId || undefined,
        tokensUsed,
      });

      return { versionId, generatedCode: newCode, tokensUsed, reply: assistantReply, action: agentResponse.action };
    }),

  // Get versions
  getVersions: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(versions)
        .where(eq(versions.projectId, input.projectId))
        .orderBy(desc(versions.createdAt));
    }),

  // Get version code
  getVersionCode: protectedProcedure
    .input(z.object({ versionId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const result = await db.select().from(versions).where(eq(versions.id, input.versionId)).limit(1);
      return result[0] || null;
    }),

  // Restore version
  restoreVersion: protectedProcedure
    .input(z.object({ projectId: z.number(), versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.update(projects)
        .set({ currentVersionId: input.versionId })
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)));
      return { success: true };
    }),

  // Get chat messages
  getChatMessages: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(chatMessages)
        .where(eq(chatMessages.projectId, input.projectId))
        .orderBy(chatMessages.createdAt);
    }),

  // Update code manually
  updateCode: protectedProcedure
    .input(z.object({ versionId: z.number(), code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.update(versions).set({ generatedCode: input.code }).where(eq(versions.id, input.versionId));
      return { success: true };
    }),

  // Publish project
  publish: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.update(projects)
        .set({ isPublished: true, status: "published", publishedAt: new Date() })
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)));
      return { success: true };
    }),
});
