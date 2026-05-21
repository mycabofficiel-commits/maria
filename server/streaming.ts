/**
 * Streaming routes for Maria AI — uses Anthropic SSE with prompt caching.
 * Mounted at /api/stream/* in server/_core/index.ts
 */
import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { projects, versions, chatMessages, apiKeys, users, usageLogs } from "../drizzle/schema";
import { eq, and, desc, count } from "drizzle-orm";
import crypto from "crypto";

const ENCRYPTION_KEY =
  process.env.JWT_SECRET?.slice(0, 32).padEnd(32, "0") ||
  "maria-default-key-32-chars-long!";

function decrypt(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function slugify(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

/** Send an SSE event */
function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Authenticate request and return user, or send 401 */
async function authenticate(req: Request, res: Response) {
  try {
    return await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Non authentifié" });
    return null;
  }
}

// ── Platform API key helpers ───────────────────────────────────────────────

/** Returns a platform-managed API key, or null if not configured */
function getPlatformKey(provider: "anthropic" | "openai" | "deepseek" | "qwen"): string | null {
  const keys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    deepseek:  process.env.DEEPSEEK_API_KEY,
    qwen:      process.env.QWEN_API_KEY,
  };
  return keys[provider] || null;
}

/** Non-streaming AI call — returns generated text */
async function callSync(
  provider: "anthropic" | "openai" | "deepseek" | "qwen",
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800
): Promise<string> {
  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
    });
    if (!r.ok) throw new Error(`${provider} sync error: ${await r.text()}`);
    const d = await r.json() as any;
    return d.content?.[0]?.text || "";
  } else {
    const baseUrls: Record<string, string> = {
      openai:   "https://api.openai.com/v1",
      deepseek: "https://api.deepseek.com/v1",
      qwen:     "https://dashscope.aliyuncs.com/compatible-mode/v1",
    };
    const baseUrl = baseUrls[provider] || "https://api.openai.com/v1";
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }] }),
    });
    if (!r.ok) throw new Error(`${provider} sync error: ${await r.text()}`);
    const d = await r.json() as any;
    return d.choices?.[0]?.message?.content || "";
  }
}

/** callSync with fault tolerance — returns null on error instead of throwing */
async function tryCallSync(
  provider: "anthropic" | "openai" | "deepseek" | "qwen",
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800
): Promise<string | null> {
  try {
    return await callSync(provider, model, apiKey, systemPrompt, userMessage, maxTokens);
  } catch {
    return null;
  }
}

/**
 * Multi-agent orchestration — enriches the prompt with briefs from intermediate agents.
 * Each agent step is fault-tolerant: if it fails, the next available agent takes over.
 *
 * FREE:   DeepSeek seul
 * CREATOR: Qwen brief → (fallback: skip) → DeepSeek exécute
 * PRO:    Claude architecture → (fallback: Qwen) → Qwen SEO → DeepSeek exécute
 * AGENCY: GPT-4o stratégie → (fallback: Claude) → Claude design → (fallback: Qwen) → Qwen copy → DeepSeek exécute
 */
async function orchestrateGenerate(
  res: Response,
  plan: string,
  prompt: string,
  siteType: string,
  style: string,
  language: string,
  colorPalette: string
): Promise<string> {
  let enriched = prompt;

  /** Emit progress + call agent, with automatic fallback chain */
  async function runStep(
    primary:  { provider: "anthropic"|"openai"|"deepseek"|"qwen"; model: string; key: string|null; agent: string; step: string; icon: string },
    fallback?: { provider: "anthropic"|"openai"|"deepseek"|"qwen"; model: string; key: string|null; agent: string; step: string; icon: string },
    systemPrompt: string = "",
    userMessage: string = "",
    maxTokens = 800
  ): Promise<string | null> {
    // Try primary agent
    if (primary.key) {
      sseWrite(res, "progress", { agent: primary.agent, step: primary.step, icon: primary.icon });
      const result = await tryCallSync(primary.provider, primary.model, primary.key, systemPrompt, userMessage, maxTokens);
      if (result) return result;
      // Primary failed — signal fallback
      sseWrite(res, "progress", { agent: primary.agent, step: `Indisponible — relais ${fallback?.agent ?? "ignoré"}`, icon: "⏭️" });
    }
    // Try fallback agent
    if (fallback?.key) {
      sseWrite(res, "progress", { agent: fallback.agent, step: fallback.step, icon: fallback.icon });
      const result = await tryCallSync(fallback.provider, fallback.model, fallback.key, systemPrompt, userMessage, maxTokens);
      if (result) return result;
      sseWrite(res, "progress", { agent: fallback.agent, step: "Indisponible — étape ignorée", icon: "⏭️" });
    }
    return null; // Both failed — step skipped silently
  }

  // ── Keys ──────────────────────────────────────────────────────────────────
  const claudeKey  = getPlatformKey("anthropic");
  const openaiKey  = getPlatformKey("openai");
  const qwenKey    = getPlatformKey("qwen");

  // ── CREATOR ───────────────────────────────────────────────────────────────
  if (plan === "creator") {
    const brief = await runStep(
      { provider: "qwen",     model: "qwen-plus",      key: qwenKey,   agent: "Qwen",   step: "Analyse & stratégie de contenu", icon: "🧠" },
      { provider: "anthropic",model: "claude-haiku-4-5",key: claudeKey, agent: "Claude", step: "Stratégie de contenu (relais)",   icon: "🧠" },
      `Tu es un expert en stratégie web. Produis un brief structuré: sections, proposition de valeur, mots-clés SEO. 150 mots max. Langue: ${language}.`,
      `Demande: ${prompt}\nType: ${siteType}\nStyle: ${style}\nPalette: ${colorPalette}`,
      600
    );
    if (brief) enriched = `${prompt}\n\n[BRIEF STRATÉGIQUE]:\n${brief}`;

  // ── PRO ───────────────────────────────────────────────────────────────────
  } else if (plan === "pro") {
    // Step 1 — Architecture (Claude → fallback Qwen)
    const architecture = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Architecture & structure du site", icon: "🏗️" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Architecture (relais)",            icon: "🏗️" },
      `Tu es un architecte web senior. Définis la structure optimale: sections, UX flow, points de conversion. 200 mots max. Langue: ${language}.`,
      `Demande: ${prompt}\nType: ${siteType}\nStyle: ${style}`,
      800
    );
    if (architecture) enriched = `${prompt}\n\n[ARCHITECTURE]:\n${architecture}`;

    // Step 2 — SEO/Copy (Qwen → fallback Claude)
    const seo = await runStep(
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Optimisation contenu & SEO",    icon: "📈" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Optimisation SEO (relais)",      icon: "📈" },
      `Tu es un expert SEO et copywriting. Propose textes optimisés, titres accrocheurs, CTAs, méta-descriptions. 250 mots max. Langue: ${language}.`,
      enriched,
      900
    );
    if (seo) enriched = `${enriched}\n\n[COPY & SEO]:\n${seo}`;

  // ── AGENCY ────────────────────────────────────────────────────────────────
  } else if (plan === "agency") {
    // Step 1 — Strategy (GPT-4o → fallback Claude)
    const strategy = await runStep(
      { provider: "openai",    model: "gpt-4o-mini",      key: openaiKey, agent: "GPT-4o", step: "Stratégie business & positionnement", icon: "🎯" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Stratégie business (relais)",          icon: "🎯" },
      `Tu es un consultant business senior. Définis: positionnement, audience cible, proposition de valeur, messages clés. 200 mots max. Langue: ${language}.`,
      `Projet: ${prompt}\nType: ${siteType}\nStyle: ${style}\nPalette: ${colorPalette}`,
      800
    );
    if (strategy) enriched = `${prompt}\n\n[STRATÉGIE BUSINESS]:\n${strategy}`;

    // Step 2 — Architecture & design (Claude → fallback Qwen)
    const architecture = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Architecture & design system", icon: "🏗️" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Architecture (relais)",        icon: "🏗️" },
      `Tu es un architecte web et designer senior. Définis: structure des sections, hiérarchie visuelle, composants clés. 250 mots max. Langue: ${language}.`,
      enriched,
      1000
    );
    if (architecture) enriched = `${enriched}\n\n[ARCHITECTURE & DESIGN]:\n${architecture}`;

    // Step 3 — Copywriting (Qwen → fallback Claude)
    const copy = await runStep(
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Copywriting & optimisation SEO", icon: "✍️" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Copywriting (relais)",            icon: "✍️" },
      `Tu es un expert SEO et copywriter senior. Génère les textes finaux: titres H1/H2, CTAs, méta-title/description. 300 mots max. Langue: ${language}.`,
      enriched,
      1000
    );
    if (copy) enriched = `${enriched}\n\n[COPY & SEO FINAL]:\n${copy}`;
  }

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerStreamingRoutes(app: Express) {
  // ── POST /api/stream/generate ─────────────────────────────────────────────
  app.post("/api/stream/generate", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { projectId, prompt, siteType, style, language, colorPalette } = req.body as {
      projectId: number;
      prompt: string;
      siteType?: string;
      style?: string;
      language?: string;
      colorPalette?: string;
    };

    if (!projectId || !prompt) {
      res.status(400).json({ error: "projectId et prompt requis" });
      return;
    }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    // Check generations limit
    const userRow = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const u = userRow[0];
    if ((u?.generationsUsed || 0) >= (u?.generationsLimit || 3)) {
      res.status(403).json({ error: "Limite de générations atteinte. Passez à un plan supérieur." });
      return;
    }

    // ── Platform DeepSeek key (final executor) — fall back to user key ────────
    const userPlan = u?.plan || "free";
    let deepseekKey = getPlatformKey("deepseek");
    if (!deepseekKey) {
      // Backward compat: try the user's own stored API key
      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
      if (keyRow[0]) {
        try { deepseekKey = decrypt(keyRow[0].encryptedKey); } catch { /* ignore */ }
      }
    }
    if (!deepseekKey) {
      res.status(400).json({ error: "Service IA temporairement indisponible. Contactez l'administrateur." });
      return;
    }

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const versionNumber = (versionCount[0]?.count || 0) + 1;

    await db.update(projects).set({ status: "generating" }).where(eq(projects.id, projectId));

    // SSE headers — must be set before any sseWrite calls
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // ── Multi-agent orchestration (creator / pro / agency) ─────────────────
    let enrichedPrompt = prompt;
    try {
      enrichedPrompt = await orchestrateGenerate(
        res, userPlan, prompt,
        siteType || "landing page", style || "moderne",
        language || "fr", colorPalette || "bleu/violet moderne"
      );
    } catch { /* orchestration failed — continue with original prompt */ }

    // ── Final execution: DeepSeek streams the HTML ─────────────────────────
    sseWrite(res, "progress", { agent: "DeepSeek", step: "Génération du code HTML…", icon: "💻" });

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

NAVIGATION MULTI-PAGES (CRITIQUE — ZÉRO LIEN CASSÉ):
- N'utilise JAMAIS href="page.html" ou href="/page" — ces liens cassent le site
- Toutes les "pages" sont des <section id="page-xxx"> dans le même fichier HTML
- Navigation JS: onclick="showPage('xxx'); return false;" + fonction showPage() en JS
- Toutes les images: URLs Unsplash valides (https://images.unsplash.com/photo-ID?w=800&q=80)
- Tous les formulaires: handler JS affichant un message de confirmation
- Tous les boutons CTA: comportement JS défini (scroll, showPage, modal, etc.)
- href="#" uniquement si ancre ou handler JS associé

DONNÉES — ANTI-HALLUCINATION (CRITIQUE):
- JAMAIS de vraies coordonnées: utilise "contact@exemple.fr", "+33 6 00 00 00 00", "12 rue de l'Exemple, 75000 Paris"
- JAMAIS de vraies personnes réelles citées comme clients/témoins
- Témoignages: prénoms génériques fictifs (Marie D., Thomas B., Sophie L.)
- Statistiques: uniquement si l'utilisateur les a fournies. Sinon n'en mets PAS.
- Prix: uniquement si l'utilisateur les a précisés. Sinon mets "Sur devis" ou "À partir de X€".
- N'invente AUCUNE information non fournie dans le prompt. Si manquante → placeholder discret.

TYPE DE SITE: ${siteType || "landing page"}
STYLE: ${style || "moderne"}
LANGUE: ${language || "fr"}
PALETTE: ${colorPalette || "bleu/violet moderne"}`;

    const userMessage = `Crée un site web complet pour: ${enrichedPrompt}

Génère un code HTML/CSS/JS complet, professionnel et prêt à l'emploi. Inclus:
- Un header avec navigation
- Un hero section accrocheur
- Des sections de contenu pertinentes
- Un footer
- Des animations CSS subtiles
- Un design responsive mobile-first
- Les meta tags SEO appropriés

Retourne UNIQUEMENT le code HTML complet, sans explication, sans markdown, sans backticks.`;

    const startTime = Date.now();
    let fullCode = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const aiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${deepseekKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          max_tokens: 8000,
          temperature: 0.3,
          stream: true,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
        }),
      });
      if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur DeepSeek: ${await aiRes.text()}` }); res.end(); return; }
      const reader = aiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw);
            const chunk = evt.choices?.[0]?.delta?.content;
            if (chunk) { fullCode += chunk; sseWrite(res, "chunk", { text: chunk }); }
            if (evt.usage) { inputTokens = evt.usage.prompt_tokens || 0; outputTokens = evt.usage.completion_tokens || 0; }
          } catch { /* skip */ }
        }
      }

      const tokensUsed = inputTokens + outputTokens;
      const durationMs = Date.now() - startTime;

      // Save version
      const [versionResult] = await db.insert(versions).values({
        projectId,
        userId: user.id,
        versionNumber,
        label: `Version ${versionNumber}`,
        prompt,
        generatedCode: fullCode,
        tokensUsed,
        generationTimeMs: durationMs,
        model: "deepseek-chat",
        status: "ready",
      }).returning({ id: versions.id });
      const versionId = versionResult.id;

      await db.update(projects).set({
        status: "ready",
        currentVersionId: versionId,
        siteType,
        style,
        language: language || "fr",
        colorPalette,
      }).where(eq(projects.id, projectId));

      await db.update(users).set({ generationsUsed: (u?.generationsUsed || 0) + 1 }).where(eq(users.id, user.id));

      await db.insert(usageLogs).values({
        userId: user.id,
        projectId,
        action: "generate",
        model: "deepseek-chat",
        tokensUsed,
        durationMs,
        status: "success",
      });

      sseWrite(res, "done", { versionId, tokensUsed, durationMs });
    } catch (err: any) {
      await db.update(projects).set({ status: "error" }).where(eq(projects.id, projectId));
      sseWrite(res, "error", { message: err.message });
    }

    res.end();
  });

  // ── POST /api/stream/chat ─────────────────────────────────────────────────
  app.post("/api/stream/chat", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { projectId, message, images } = req.body as {
      projectId: number;
      message: string;
      images?: Array<{ base64: string; mimeType: string }>;
    };
    if (!projectId || !message) {
      res.status(400).json({ error: "projectId et message requis" });
      return;
    }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const project = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!project[0]) { res.status(404).json({ error: "Projet introuvable" }); return; }

    const currentVersion = await db.select().from(versions)
      .where(eq(versions.id, project[0].currentVersionId!)).limit(1);
    if (!currentVersion[0]) { res.status(400).json({ error: "Aucune version générée" }); return; }

    // Platform DeepSeek key for chat (fall back to user key)
    let apiKey: string;
    let provider = "deepseek";
    let modelToUse = "deepseek-chat";
    const platformChatKey = getPlatformKey("deepseek");
    if (platformChatKey) {
      apiKey = platformChatKey;
    } else {
      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
      if (!keyRow[0]) { res.status(400).json({ error: "Aucune clé API configurée" }); return; }
      try { apiKey = decrypt(keyRow[0].encryptedKey); }
      catch { res.status(400).json({ error: "Clé API invalide" }); return; }
      provider = keyRow[0].provider || "anthropic";
      modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
        ? "claude-sonnet-4-5"
        : (keyRow[0].model || "claude-sonnet-4-5");
    }

    // Save user message
    await db.insert(chatMessages).values({
      projectId,
      userId: user.id,
      role: "user",
      content: message,
    });

    const history = await db.select().from(chatMessages)
      .where(eq(chatMessages.projectId, projectId))
      .orderBy(chatMessages.createdAt)
      .limit(30);

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const totalVersions = versionCount[0]?.count || 0;

    const projectCreatedAt = project[0].createdAt
      ? new Date(project[0].createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
      : "date inconnue";

    const systemPrompt = `Tu es Mar-ia, l'IA créatrice de sites web intégrée à la plateforme Mar-ia.
Tu travailles sur le projet "${project[0].name || "Sans nom"}" (créé le ${projectCreatedAt}, ${totalVersions} version(s) au total).
Tu as accès au code HTML complet du site ci-dessous. Utilise-le — ne l'invente pas.

QUI TU ES:
- Tu t'appelles Mar-ia, tu es experte en HTML/CSS/JS vanilla
- Tu connais l'historique complet de la conversation et du projet
- Tu peux répondre à des questions, donner des conseils, ou modifier le code
- Tu es précise, factuelle et concise

FORMAT DE RÉPONSE — TOUJOURS l'un des deux JSON valides ci-dessous, RIEN D'AUTRE:

Si modification/création/correction demandée:
{"action":"modify","reply":"Ce que tu as fait en une phrase claire","code":"<html complet>"}

Si question, conseil ou conversation uniquement:
{"action":"chat","reply":"Ta réponse en markdown"}

RÈGLES STRICTES:
- Le champ "reply" TOUJOURS EN PREMIER dans le JSON, avant "code"
- TOUJOURS agir sur la demande, jamais expliquer sans agir
- JAMAIS inventer un bug ou problème non mentionné par l'utilisateur
- JAMAIS répondre sans JSON valide
- JAMAIS tronquer le code — il doit être complet et fonctionnel
- Réponds dans la langue de l'utilisateur (détecte automatiquement)
- "Crée X" → code X immédiatement dans le HTML
- "Modifie Y" → modifie Y dans le code existant
- "Il y a un bug Z" → corrige Z
- Pour les questions : réponds en markdown (listes, gras, code inline si pertinent)
- Si une information est manquante, utilise un placeholder générique (ex: "Votre titre", "contact@exemple.fr") — ne l'invente pas

ANTI-HALLUCINATION — INTERDIT ABSOLU:
- Inventer des données non fournies par l'utilisateur (stats, prix, noms réels, adresses, numéros de téléphone)
- Ajouter des fonctionnalités non demandées
- Citer de vraies personnes ou entreprises réelles comme références
- Créer de faux témoignages avec des noms qui ressemblent à de vraies personnes
- Affirmer que quelque chose "existe dans le code" si ce n'est pas dans le code fourni ci-dessous
- Demander à l'utilisateur de te montrer son code (tu l'as déjà ci-dessous)
- Mettre "reply" après "code" dans le JSON
- Utiliser href="page.html" ou liens vers des fichiers .html séparés
- Laisser des images cassées (src="#", src="", chemins locaux)

RÈGLES CODE (chaque modification doit les respecter):
- Navigation multi-pages = JS pur avec sections <section id="page-xxx"> + fonction showPage()
- Images = URLs Unsplash valides ou SVG inline
- Boutons/formulaires = handlers JS définis

CODE ACTUEL DU SITE (version ${currentVersion[0].versionNumber || "?"}):
${currentVersion[0].generatedCode || ""}`;

    // Build conversation messages; inject images into last user turn if provided
    const llmMessages: Array<{ role: "user" | "assistant"; content: any }> = history
      .filter(m => m.content && m.content.trim())
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content || "" }));

    // If images attached: build multimodal last message
    if (images && images.length > 0) {
      // Replace last user message (the current one) with multimodal content
      const lastUserMsg = llmMessages.pop(); // remove the just-saved text message
      const imageBlocks = images.map(img => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType as any, data: img.base64 },
      }));
      llmMessages.push({
        role: "user",
        content: [...imageBlocks, { type: "text", text: message }],
      });
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const startTime = Date.now();
    let fullRaw = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      if (provider === "anthropic") {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: modelToUse,
            max_tokens: 16000,
            temperature: 0.3,
            stream: true,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            messages: llmMessages,
          }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur API: ${await aiRes.text()}` }); res.end(); return; }
        const reader = aiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") { fullRaw += evt.delta.text; sseWrite(res, "chunk", { text: evt.delta.text }); }
              if (evt.type === "message_delta" && evt.usage) outputTokens = evt.usage.output_tokens || 0;
              if (evt.type === "message_start" && evt.message?.usage) inputTokens = evt.message.usage.input_tokens || 0;
            } catch { /* skip */ }
          }
        }
      } else {
        // OpenAI-compatible providers (DeepSeek, OpenAI, Mistral, Groq…)
        const baseUrls: Record<string, string> = {
          deepseek: "https://api.deepseek.com/v1",
          openai: "https://api.openai.com/v1",
          mistral: "https://api.mistral.ai/v1",
          groq: "https://api.groq.com/openai/v1",
        };
        const baseUrl = baseUrls[provider] || "https://api.openai.com/v1";
        const allMessages = [{ role: "system", content: systemPrompt }, ...llmMessages];
        const aiRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: modelToUse, max_tokens: 16000, temperature: 0.3, stream: true, messages: allMessages }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur API ${provider}: ${await aiRes.text()}` }); res.end(); return; }
        const reader = aiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              const chunk = evt.choices?.[0]?.delta?.content;
              if (chunk) { fullRaw += chunk; sseWrite(res, "chunk", { text: chunk }); }
              if (evt.usage) { inputTokens = evt.usage.prompt_tokens || 0; outputTokens = evt.usage.completion_tokens || 0; }
            } catch { /* skip */ }
          }
        }
      }

      const tokensUsed = inputTokens + outputTokens;
      const durationMs = Date.now() - startTime;

      // Parse agent response
      let agentResponse: { action: string; code?: string; reply: string };
      try {
        const jsonMatch = fullRaw.match(/\{[\s\S]*\}/);
        agentResponse = JSON.parse(jsonMatch ? jsonMatch[0] : fullRaw);
      } catch {
        agentResponse = { action: "chat", reply: fullRaw };
      }

      let versionId: number | null = null;

      if (agentResponse.action === "modify" && agentResponse.code) {
        const nextVersionNumber = totalVersions + 1;
        const [versionResult] = await db.insert(versions).values({
          projectId,
          userId: user.id,
          versionNumber: nextVersionNumber,
          label: `Version ${nextVersionNumber} — ${message.slice(0, 50)}`,
          prompt: message,
          generatedCode: agentResponse.code,
          tokensUsed,
          generationTimeMs: durationMs,
          model: modelToUse,
          status: "ready",
        }).returning({ id: versions.id });
        versionId = versionResult.id;
        await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, projectId));
      }

      const assistantReply = agentResponse.reply || "Je suis là pour vous aider !";
      await db.insert(chatMessages).values({
        projectId,
        userId: user.id,
        role: "assistant",
        content: assistantReply,
        versionId: versionId || undefined,
        tokensUsed,
      });

      sseWrite(res, "done", {
        versionId,
        tokensUsed,
        reply: assistantReply,
        action: agentResponse.action,
        generatedCode: agentResponse.code || null,
      });
    } catch (err: any) {
      sseWrite(res, "error", { message: err.message });
    }

    res.end();
  });

  // ── POST /api/stream/debug ────────────────────────────────────────────────
  app.post("/api/stream/debug", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { projectId } = req.body as { projectId: number };
    if (!projectId) { res.status(400).json({ error: "projectId requis" }); return; }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const project = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!project[0]) { res.status(404).json({ error: "Projet introuvable" }); return; }

    const currentVersion = await db.select().from(versions)
      .where(eq(versions.id, project[0].currentVersionId!)).limit(1);
    if (!currentVersion[0]?.generatedCode) { res.status(400).json({ error: "Aucune version à débugger" }); return; }

    // Platform Anthropic key for debug (fall back to user key)
    let apiKey: string;
    let provider = "anthropic";
    let modelToUse = "claude-haiku-4-5";
    const platformDebugKey = getPlatformKey("anthropic");
    if (platformDebugKey) {
      apiKey = platformDebugKey;
    } else {
      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
      if (!keyRow[0]) { res.status(400).json({ error: "Aucune clé API configurée" }); return; }
      try { apiKey = decrypt(keyRow[0].encryptedKey); }
      catch { res.status(400).json({ error: "Clé API invalide" }); return; }
      provider = keyRow[0].provider || "anthropic";
      modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
        ? "claude-sonnet-4-5"
        : (keyRow[0].model || "claude-sonnet-4-5");
    }

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const nextVersionNumber = (versionCount[0]?.count || 0) + 1;

    const systemPrompt = `Tu es un expert en qualité web et débogage. Analyse le code HTML/CSS/JS fourni et corrige TOUS les problèmes.

CORRECTIONS OBLIGATOIRES:
1. LIENS CASSÉS: href="page.html", href="/page" → navigation JS avec sections <section id="page-xxx"> et fonction showPage()
2. IMAGES CASSÉES: src="", src="#", chemins locaux → https://images.unsplash.com/photo-ID?w=800&q=80 (thématiques)
3. ERREURS JS: variables/fonctions inexistantes, event listeners sans cible, console.error visibles
4. BOUTONS SANS ACTION: chaque bouton/CTA doit avoir un onclick ou data-action défini
5. FORMULAIRES: chaque form doit avoir un onsubmit JS affichant un message de succès
6. CONTENU: remplace Lorem ipsum et placeholders par du vrai contenu logique et professionnel

Retourne UNIQUEMENT ce JSON (rien d'autre, pas de markdown):
{"fixed_code":"<!DOCTYPE html>...code HTML complet corrigé...","report":"• Bug 1 corrigé\\n• Bug 2 corrigé"}`;

    const userMessage = `Analyse et corrige ce code:\n\n${currentVersion[0].generatedCode}`;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const startTime = Date.now();
    let fullRaw = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      if (provider === "anthropic") {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: modelToUse,
            max_tokens: 8000,
            stream: true,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        });
        if (!aiRes.ok || !aiRes.body) {
          const errText = await aiRes.text();
          const errData = JSON.parse(errText).catch?.(() => ({})) || {};
          sseWrite(res, "error", { message: `Erreur API: ${(errData as any)?.error?.message || errText}` });
          res.end(); return;
        }
        const reader = aiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") { fullRaw += evt.delta.text; }
              if (evt.type === "message_delta" && evt.usage) outputTokens = evt.usage.output_tokens || 0;
              if (evt.type === "message_start" && evt.message?.usage) inputTokens = evt.message.usage.input_tokens || 0;
              if (evt.type === "error") { sseWrite(res, "error", { message: evt.error?.message || "Erreur API" }); res.end(); return; }
            } catch { /* skip */ }
          }
        }
      } else {
        const baseUrls: Record<string, string> = {
          deepseek: "https://api.deepseek.com/v1",
          openai: "https://api.openai.com/v1",
          mistral: "https://api.mistral.ai/v1",
          groq: "https://api.groq.com/openai/v1",
        };
        const baseUrl = baseUrls[provider] || "https://api.openai.com/v1";
        const aiRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: modelToUse,
            max_tokens: 8000,
            temperature: 0.3,
            stream: true,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
          }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur API ${provider}: ${await aiRes.text()}` }); res.end(); return; }
        const reader = aiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              const chunk = evt.choices?.[0]?.delta?.content;
              if (chunk) fullRaw += chunk;
              if (evt.usage) { inputTokens = evt.usage.prompt_tokens || 0; outputTokens = evt.usage.completion_tokens || 0; }
            } catch { /* skip */ }
          }
        }
      }

      const tokensUsed = inputTokens + outputTokens;
      const durationMs = Date.now() - startTime;

      // Parse result
      let fixedCode = "";
      let report = "Analyse terminée.";
      try {
        const jsonMatch = fullRaw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : fullRaw);
        fixedCode = parsed.fixed_code || parsed.code || "";
        report = parsed.report || "Code corrigé.";
      } catch {
        if (fullRaw.trim().startsWith("<!DOCTYPE") || fullRaw.trim().startsWith("<html")) {
          fixedCode = fullRaw.trim();
          report = "Code corrigé.";
        } else {
          sseWrite(res, "error", { message: "Le modèle n'a pas retourné de code valide" });
          res.end(); return;
        }
      }

      if (!fixedCode) { sseWrite(res, "error", { message: "Aucun code corrigé reçu" }); res.end(); return; }

      // Save new version
      const [versionResult] = await db.insert(versions).values({
        projectId,
        userId: user.id,
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
      }).where(eq(projects.id, projectId));

      await db.insert(usageLogs).values({
        userId: user.id,
        projectId,
        action: "debug",
        model: modelToUse,
        tokensUsed,
        durationMs,
        status: "success",
      }).catch(() => {});

      sseWrite(res, "done", { versionId: versionResult.id, report, tokensUsed });
    } catch (err: any) {
      sseWrite(res, "error", { message: err.message });
    }

    res.end();
  });
}
