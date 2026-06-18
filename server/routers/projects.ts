import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { projects, versions, chatMessages, projectFiles, usageLogs, users, apiKeys, projectCollaborators } from "../../drizzle/schema";
import { eq, desc, and, count, sum } from "drizzle-orm";
import { PLAN_LIMITS, type PlanName } from "@shared/const";
import crypto from "crypto";
import { buildInspirationContext } from "../inspiration";

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

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Vérifie que le projet appartient à l'utilisateur. Lève sinon (anti-IDOR). */
async function assertOwnedProject(db: Db, projectId: number, userId: number): Promise<void> {
  const rows = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new Error("Projet introuvable");
}

/** Vérifie que la version appartient (via son projet) à l'utilisateur. Lève sinon (anti-IDOR). */
async function assertOwnedVersion(db: Db, versionId: number, userId: number): Promise<void> {
  const rows = await db.select({ id: versions.id }).from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(versions.id, versionId), eq(projects.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new Error("Version introuvable");
}

/**
 * Accès en LECTURE à un projet : autorisé au propriétaire OU à un collaborateur
 * dont l'invitation est acceptée. Lève "Projet introuvable" sinon (anti-IDOR :
 * on ne révèle pas l'existence du projet aux non-membres).
 */
async function assertProjectAccess(db: Db, projectId: number, userId: number): Promise<void> {
  const owned = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (owned[0]) return;
  const collab = await db.select({ id: projectCollaborators.id }).from(projectCollaborators)
    .where(and(
      eq(projectCollaborators.projectId, projectId),
      eq(projectCollaborators.collaboratorId, userId),
      eq(projectCollaborators.status, "accepted"),
    ))
    .limit(1);
  if (collab[0]) return;
  throw new Error("Projet introuvable");
}

/** Idem mais à partir d'une version (résout le projet de la version). */
async function assertVersionAccess(db: Db, versionId: number, userId: number): Promise<void> {
  const v = await db.select({ projectId: versions.projectId }).from(versions)
    .where(eq(versions.id, versionId)).limit(1);
  if (!v[0]) throw new Error("Version introuvable");
  await assertProjectAccess(db, v[0].projectId, userId);
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
      await assertProjectAccess(db, input.id, ctx.user.id); // propriétaire OU collaborateur accepté
      const result = await db.select().from(projects)
        .where(eq(projects.id, input.id))
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
      framework: z.enum(["html", "react", "nextjs", "expo"]).default("html"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // Check plan limits
      const userRow = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const u = userRow[0];
      const limits = PLAN_LIMITS[(u?.plan || "free") as PlanName] || PLAN_LIMITS.free;
      const limit = limits.projectsLimit;
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
      }).returning({ id: projects.id });
      return { id: result.id };
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
      framework: z.enum(["html", "react", "nextjs", "expo"]).default("html"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Anti-IDOR : le projet doit appartenir à l'utilisateur
      await assertOwnedProject(db, input.projectId, ctx.user.id);

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

      // Parse & scrape inspiration URLs embedded in the prompt
      const { cleanPrompt, context: inspirationContext } = await buildInspirationContext(input.prompt);

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

NAVIGATION MULTI-PAGES (CRITIQUE):
- N'utilise JAMAIS de liens vers des fichiers .html séparés (ex: href="contact.html")
- Toutes les "pages" doivent être des sections dans le même fichier HTML
- Pour la navigation multi-pages, utilise du JavaScript pour afficher/masquer des sections:
  * Chaque page = une <section id="page-accueil">, <section id="page-contact"> etc.
  * La navigation JS montre/masque les sections avec classList.toggle('hidden')
  * Les liens de nav utilisent href="#" avec onclick="showPage('contact')"
- Toutes les images utilisent des URLs valides (https://images.unsplash.com ou SVG inline)
- Aucun lien cassé : chaque href pointe vers une ancre existante (#section) ou appelle une fonction JS
- Tous les formulaires ont un handler JS qui affiche un message de confirmation
- Tous les boutons d'action ont un comportement défini

TYPE DE SITE: ${input.siteType || "landing page"}
STYLE: ${input.style || "moderne"}
LANGUE: ${input.language}
PALETTE: ${input.colorPalette || "bleu/violet moderne"}${inspirationContext}`;

      const userMessage = `Crée un site web complet pour: ${cleanPrompt}

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
        }).returning({ id: versions.id });
        const versionId = versionResult.id;

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
      const systemPrompt = `Tu es Mar-ia, une IA experte en création de sites web. Tu es l'assistante personnelle de l'utilisateur pour ce projet web.

CONTEXTE DU PROJET:
- Nom du projet: ${project[0].name}
- Description: ${project[0].description || "Non définie"}
- Nombre de versions créées: ${totalVersions}
- Code actuel du site (HTML complet):
${currentVersion[0].generatedCode}

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
- Réponds dans la langue de l'utilisateur

RÈGLES CODE (à respecter pour chaque modification):
- N'utilise JAMAIS de liens vers des fichiers .html séparés (ex: href="contact.html")
- Toutes les pages/sections sont dans le même fichier HTML avec navigation JavaScript
- Toutes les images utilisent des URLs valides (https://images.unsplash.com ou SVG inline)
- Aucun lien href="#" sans ancre ou handler JS défini
- Tous les boutons et formulaires ont un comportement JS fonctionnel`;

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
          max_tokens: 16000,
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
      console.log("[chat] rawReply preview:", rawReply.slice(0, 400));
      console.log("[chat] stop_reason:", data.stop_reason, "output_tokens:", data.usage?.output_tokens);

      // Parse agent response — try direct parse, then markdown strip, then brace extraction
      let agentResponse: { action: string; code?: string; reply: string };
      try {
        // Strip markdown code fences if present
        const stripped = rawReply.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        // Find the outermost JSON object using balanced brace matching
        let jsonStr: string | null = null;
        const start = stripped.indexOf("{");
        if (start !== -1) {
          let depth = 0, inStr = false, escape = false;
          for (let i = start; i < stripped.length; i++) {
            const ch = stripped[i];
            if (escape) { escape = false; continue; }
            if (ch === "\\" && inStr) { escape = true; continue; }
            if (ch === '"') inStr = !inStr;
            if (!inStr) {
              if (ch === "{") depth++;
              else if (ch === "}") { depth--; if (depth === 0) { jsonStr = stripped.slice(start, i + 1); break; } }
            }
          }
        }
        agentResponse = JSON.parse(jsonStr ?? stripped);
        console.log("[chat] parse OK — action:", agentResponse.action, "hasCode:", !!agentResponse.code);
      } catch (e) {
        console.log("[chat] parse FAILED:", String(e), "— fallback to chat action");
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
        }).returning({ id: versions.id });
        versionId = versionResult.id;
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
      await assertProjectAccess(db, input.projectId, ctx.user.id); // propriétaire OU collaborateur accepté
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
      await assertVersionAccess(db, input.versionId, ctx.user.id); // propriétaire OU collaborateur accepté
      const result = await db.select().from(versions).where(eq(versions.id, input.versionId)).limit(1);
      return result[0] || null;
    }),

  // Restore version
  restoreVersion: protectedProcedure
    .input(z.object({ projectId: z.number(), versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // Anti-IDOR : projet possédé ET version appartenant bien à ce projet
      await assertOwnedProject(db, input.projectId, ctx.user.id);
      const v = await db.select({ id: versions.id }).from(versions)
        .where(and(eq(versions.id, input.versionId), eq(versions.projectId, input.projectId)))
        .limit(1);
      if (!v[0]) throw new Error("Version introuvable");
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
      await assertProjectAccess(db, input.projectId, ctx.user.id); // propriétaire OU collaborateur accepté
      return db.select().from(chatMessages)
        .where(eq(chatMessages.projectId, input.projectId))
        .orderBy(chatMessages.createdAt, chatMessages.id);
    }),

  // Clear chat history for a project
  clearChat: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.delete(chatMessages).where(
        and(eq(chatMessages.projectId, input.projectId), eq(chatMessages.userId, ctx.user.id))
      );
      return { success: true };
    }),

  // 👍 / 👎 sur une réponse de l'IA. feedback=null pour retirer le vote (toggle).
  setMessageFeedback: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      feedback: z.enum(["up", "down"]).nullable(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const row = await db.select({ projectId: chatMessages.projectId })
        .from(chatMessages).where(eq(chatMessages.id, input.messageId)).limit(1);
      if (!row[0]) throw new Error("Message introuvable");
      await assertOwnedProject(db, row[0].projectId, ctx.user.id); // anti-IDOR
      await db.update(chatMessages)
        .set({ feedback: input.feedback, feedbackReason: input.feedback ? (input.reason ?? null) : null })
        .where(eq(chatMessages.id, input.messageId));
      return { success: true };
    }),

  // Update code manually
  updateCode: protectedProcedure
    .input(z.object({ versionId: z.number(), code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await assertOwnedVersion(db, input.versionId, ctx.user.id); // anti-IDOR
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

  // Debug & fix code
  debugCode: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new Error("Projet introuvable");

      const currentVersion = await db.select().from(versions)
        .where(eq(versions.id, project[0].currentVersionId!))
        .limit(1);
      if (!currentVersion[0]?.generatedCode) throw new Error("Aucune version à débugger");

      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).limit(1);
      if (!keyRow[0]) throw new Error("Aucune clé API configurée");
      const apiKey = decrypt(keyRow[0].encryptedKey);

      const modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
        ? "claude-sonnet-4-5"
        : keyRow[0].model;

      const startTime = Date.now();

      const systemPrompt = `Tu es un expert en qualité web et débogage. Tu analyses du code HTML/CSS/JS et tu le corriges intégralement.

ANALYSE ET CORRECTIONS À EFFECTUER:

1. LIENS CASSÉS:
   - Remplace TOUS les liens href="page.html", href="/page", href="./page" par de la navigation JavaScript
   - Crée les sections manquantes avec du contenu logique et professionnel
   - Structure: chaque page = <section id="page-xxx" class="page-section"> avec JS pour afficher/masquer
   - Les liens de navigation utilisent onclick="showPage('xxx'); return false;"
   - Ajoute la fonction showPage() en JS si elle n'existe pas

2. IMAGES CASSÉES:
   - Remplace src="" , src="#", src="image.jpg" (chemins locaux) par des images Unsplash valides thématiques
   - Format: https://images.unsplash.com/photo-XXXXX?w=800&q=80

3. ERREURS JAVASCRIPT:
   - Corrige toutes les références à des variables/fonctions inexistantes
   - Assure que tous les event listeners ciblent des éléments qui existent
   - Tous les formulaires doivent avoir un handler qui affiche un message de succès

4. BOUTONS/CTA SANS ACTION:
   - Chaque bouton doit avoir un comportement défini (scroll, showPage, form submit, etc.)

5. CONTENU MANQUANT:
   - Remplis les placeholder "Lorem ipsum" avec du vrai contenu logique
   - Complète les sections avec contenu, prix, équipe, FAQ selon le type de site

Réponds UNIQUEMENT avec ce JSON (code HTML complet corrigé):
{"fixed_code":"<DOCTYPE html>...code complet...</html>","report":"• Problème 1 corrigé\\n• Problème 2 corrigé\\n..."}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelToUse,
          max_tokens: 12000,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: `Analyse et corrige ce code:\n\n${currentVersion[0].generatedCode}`,
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Erreur API: ${err}`);
      }

      const data = await response.json() as any;
      const rawReply = data.content?.[0]?.text || "{}";
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
      const durationMs = Date.now() - startTime;

      let fixedCode: string;
      let report: string;
      try {
        const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawReply);
        fixedCode = parsed.fixed_code || parsed.code || "";
        report = parsed.report || "Analyse terminée.";
      } catch {
        // If JSON parse fails, treat the whole response as HTML if it starts with <!DOCTYPE
        if (rawReply.trim().startsWith("<!DOCTYPE") || rawReply.trim().startsWith("<html")) {
          fixedCode = rawReply.trim();
          report = "Code corrigé.";
        } else {
          throw new Error("Réponse inattendue du modèle");
        }
      }

      if (!fixedCode) throw new Error("Le modèle n'a pas retourné de code corrigé");

      // Save as new version
      const versionCount = await db.select({ count: count() }).from(versions)
        .where(eq(versions.projectId, input.projectId));
      const nextVersionNumber = (versionCount[0]?.count || 0) + 1;

      const [versionResult] = await db.insert(versions).values({
        projectId: input.projectId,
        userId: ctx.user.id,
        versionNumber: nextVersionNumber,
        label: `Debug v${nextVersionNumber}`,
        prompt: "Débogage automatique",
        generatedCode: fixedCode,
        tokensUsed,
        generationTimeMs: durationMs,
        model: modelToUse,
        status: "ready",
      }).returning({ id: versions.id });

      await db.update(projects).set({
        currentVersionId: versionResult.id,
        status: "ready",
      }).where(eq(projects.id, input.projectId));

      // Log
      await db.insert(usageLogs).values({
        userId: ctx.user.id,
        projectId: input.projectId,
        tokensUsed,
        model: modelToUse,
        action: "debug",
      }).catch(() => {});

      return { versionId: versionResult.id, report, tokensUsed };
    }),

  // Get project details (code size, total tokens, version count)
  getDetails: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new Error("Projet introuvable");

      const [latestVersion, tokenRow, versionCountRow] = await Promise.all([
        db.select({ generatedCode: versions.generatedCode, tokensUsed: versions.tokensUsed })
          .from(versions).where(eq(versions.projectId, input.id))
          .orderBy(desc(versions.createdAt)).limit(1),
        db.select({ total: sum(usageLogs.tokensUsed) }).from(usageLogs)
          .where(and(eq(usageLogs.projectId, input.id), eq(usageLogs.userId, ctx.user.id))),
        db.select({ count: count() }).from(versions).where(eq(versions.projectId, input.id)),
      ]);

      return {
        id: project[0].id,
        createdAt: project[0].createdAt,
        updatedAt: project[0].updatedAt,
        siteType: project[0].siteType,
        style: project[0].style,
        colorPalette: project[0].colorPalette,
        framework: project[0].framework,
        codeSizeBytes: latestVersion[0]?.generatedCode?.length || 0,
        totalTokens: Number(tokenRow[0]?.total || 0),
        versionsCount: versionCountRow[0]?.count || 0,
      };
    }),

  // Rename project
  rename: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)));
      return { success: true };
    }),
});
