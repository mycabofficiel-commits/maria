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

    // Get API key
    const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
    if (!keyRow[0]) { res.status(400).json({ error: "Aucune clé API Anthropic configurée." }); return; }
    let apiKey: string;
    try { apiKey = decrypt(keyRow[0].encryptedKey); }
    catch { res.status(400).json({ error: "Clé API invalide." }); return; }

    const modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
      ? "claude-sonnet-4-5"
      : keyRow[0].model;

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const versionNumber = (versionCount[0]?.count || 0) + 1;

    await db.update(projects).set({ status: "generating" }).where(eq(projects.id, projectId));

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

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

TYPE DE SITE: ${siteType || "landing page"}
STYLE: ${style || "moderne"}
LANGUE: ${language || "fr"}
PALETTE: ${colorPalette || "bleu/violet moderne"}`;

    const userMessage = `Crée un site web complet pour: ${prompt}

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
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelToUse,
          max_tokens: 8000,
          stream: true,
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" }, // Prompt caching
            },
          ],
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!anthropicRes.ok || !anthropicRes.body) {
        const err = await anthropicRes.text();
        sseWrite(res, "error", { message: `Erreur API Anthropic: ${err}` });
        res.end();
        return;
      }

      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                const chunk = evt.delta.text;
                fullCode += chunk;
                sseWrite(res, "chunk", { text: chunk });
              }
              if (evt.type === "message_delta" && evt.usage) {
                outputTokens = evt.usage.output_tokens || 0;
              }
              if (evt.type === "message_start" && evt.message?.usage) {
                inputTokens = evt.message.usage.input_tokens || 0;
              }
            } catch { /* skip malformed lines */ }
          }
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
        model: modelToUse,
        status: "ready",
      });
      const versionId = (versionResult as any).insertId;

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
        model: modelToUse,
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

    const { projectId, message } = req.body as { projectId: number; message: string };
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

    const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
    if (!keyRow[0]) { res.status(400).json({ error: "Aucune clé API Anthropic configurée" }); return; }
    const apiKey = decrypt(keyRow[0].encryptedKey);

    const modelToUse = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"].includes(keyRow[0].model)
      ? "claude-sonnet-4-5"
      : keyRow[0].model;

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
      .limit(20);

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const totalVersions = versionCount[0]?.count || 0;

    const systemPrompt = `Tu es Maria, une IA spécialisée en création et modification de sites web.
Tu as accès au code HTML complet du site ci-dessous. Utilise-le — ne l'invente pas.

MÉTHODE DE TRAVAIL: Plan → Action → Résultat
1. Lis la demande exacte de l'utilisateur
2. Applique la modification dans le code existant
3. Retourne le code complet modifié

FORMAT DE RÉPONSE — TOUJOURS l'un des deux JSON suivants, rien d'autre:

Si modification/création/correction demandée:
{"action":"modify","code":"<html complet>","reply":"Ce que tu as fait en une phrase"}

Si question ou conversation uniquement:
{"action":"chat","reply":"Ta réponse"}

RÈGLES STRICTES:
- TOUJOURS agir sur la demande, jamais expliquer sans agir
- JAMAIS demander plus d'informations — tu as le code, agis
- JAMAIS inventer un bug ou problème non mentionné par l'utilisateur
- JAMAIS répondre sans JSON valide
- JAMAIS tronquer le code — il doit être complet et fonctionnel
- Réponds dans la langue de l'utilisateur
- "Crée X" → code X immédiatement dans le HTML
- "Modifie Y" → modifie Y dans le code existant
- "Il y a un bug Z" → corrige Z

INTERDIT:
- Demander à l'utilisateur de te montrer son code (tu l'as déjà ci-dessous)
- Inventer des données ou du contexte
- Répondre sans modifier le code si une action est demandée
- Halluciner des erreurs ou états non confirmés

CODE ACTUEL DU SITE:
${currentVersion[0].generatedCode || ""}`;

    const llmMessages = history
      .filter(m => m.content && m.content.trim())
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content || "" }));

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
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
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
          stream: true,
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" }, // Prompt caching
            },
          ],
          messages: llmMessages,
        }),
      });

      if (!anthropicRes.ok || !anthropicRes.body) {
        const err = await anthropicRes.text();
        sseWrite(res, "error", { message: `Erreur API: ${err}` });
        res.end();
        return;
      }

      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                fullRaw += evt.delta.text;
                // Stream the raw JSON text as it arrives
                sseWrite(res, "chunk", { text: evt.delta.text });
              }
              if (evt.type === "message_delta" && evt.usage) {
                outputTokens = evt.usage.output_tokens || 0;
              }
              if (evt.type === "message_start" && evt.message?.usage) {
                inputTokens = evt.message.usage.input_tokens || 0;
              }
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
        });
        versionId = (versionResult as any).insertId;
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
}
