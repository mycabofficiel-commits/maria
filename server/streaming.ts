/**
 * Streaming routes for Maria AI — uses Anthropic SSE with prompt caching.
 * Mounted at /api/stream/* in server/_core/index.ts
 */
import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { projects, versions, chatMessages, apiKeys, users, usageLogs, platformApiKeys } from "../drizzle/schema";
import { eq, and, desc, count, sum, gte } from "drizzle-orm";
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

// ── Agent plan configuration ─────────────────────────────────────────────────
type Provider = "openai" | "anthropic" | "qwen" | "deepseek";

const PROVIDER_MODELS: Record<Provider, string> = {
  openai:    "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  qwen:      "qwen-plus",
  deepseek:  "deepseek-chat",
};

const AGENT_NAMES: Record<Provider, string> = {
  openai:    "GPT-4o",
  anthropic: "Claude",
  qwen:      "Qwen",
  deepseek:  "DeepSeek",
};

// Fallback chain: descending capability — if primary unavailable, try next
const FALLBACK_CHAIN: Provider[] = ["openai", "anthropic", "qwen", "deepseek"];

interface PlanConfig {
  reasoner:   Provider;   // Étape 1: comprend & reformule
  agent:      Provider;   // Étape 2: planifie les modifications
  executors:  Provider[]; // Étape 3: génère le code (dernier = streaming)
  controller: Provider;   // Étape 4: teste & valide
  suggester:  Provider;   // Étape 5: propose A/B/C
}

const PLAN_CONFIGS: Record<string, PlanConfig> = {
  free: {
    reasoner: "deepseek", agent: "deepseek", executors: ["deepseek"],
    controller: "deepseek", suggester: "deepseek",
  },
  creator: {  // label UI: "Pro"
    reasoner: "qwen", agent: "qwen", executors: ["deepseek"],
    controller: "qwen", suggester: "qwen",
  },
  pro: {       // label UI: "Ultra Pro"
    reasoner: "anthropic", agent: "qwen", executors: ["deepseek"],
    controller: "anthropic", suggester: "anthropic",
  },
  agency: {   // label UI: "Agency"
    reasoner: "openai", agent: "anthropic", executors: ["qwen", "deepseek"],
    controller: "anthropic", suggester: "openai",
  },
};

/** Resolve a provider with automatic fallback down the capability chain */
function resolveKey(
  desired: Provider,
  keys: Partial<Record<Provider, string | null>>
): { provider: Provider; model: string; key: string } | null {
  const startIdx = FALLBACK_CHAIN.indexOf(desired);
  for (let i = startIdx; i < FALLBACK_CHAIN.length; i++) {
    const p = FALLBACK_CHAIN[i];
    const k = keys[p];
    if (k) return { provider: p, model: PROVIDER_MODELS[p], key: k };
  }
  return null;
}

// ── Token pricing (USD per 1 M tokens) ───────────────────────────────────────
const COST_PER_M: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini":       { in: 0.15,  out: 0.60  },
  "gpt-4o":            { in: 2.50,  out: 10.00 },
  "claude-haiku-4-5":  { in: 0.80,  out: 4.00  },
  "claude-sonnet-4-5": { in: 3.00,  out: 15.00 },
  "qwen-plus":         { in: 0.40,  out: 1.20  },
  "deepseek-chat":     { in: 0.14,  out: 0.28  },
};

/** Cost in USD — stored as micro-USD integer (multiply by 1e6) in the DB */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = COST_PER_M[model];
  if (!p) return 0;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

interface LlmResult { text: string; inputTokens: number; outputTokens: number; }

/**
 * Static code validator — runs instantly, no LLM cost.
 * Returns a list of specific issues found in the generated HTML/CSS/JS.
 * Used BEFORE the LLM controller to give the executor precise feedback.
 */
function validateGeneratedCode(html: string): string[] {
  const issues: string[] = [];

  // 1. Truncation — missing closing tags
  if (!html.includes('</html>')) issues.push('Code tronqué : </html> manquant');
  else if (!html.includes('</body>')) issues.push('Code tronqué : </body> manquant');
  const styleOpen  = (html.match(/<style(?:[^>]*)>/gi) || []).length;
  const styleClose = (html.match(/<\/style>/gi) || []).length;
  if (styleOpen > styleClose) issues.push(`${styleOpen - styleClose} balise(s) <style> non fermée(s)`);
  const scriptOpen  = (html.match(/<script(?![^>]*src)[^>]*>/gi) || []).length;
  const scriptClose = (html.match(/<\/script>/gi) || []).length;
  if (scriptOpen > scriptClose) issues.push(`${scriptOpen - scriptClose} balise(s) <script> non fermée(s)`);

  // 2. Navigation bugs — href="#xxx" instead of showPage()
  const badLinks = html.match(/href="#[a-zA-Z][^"]{1,40}"/g) || [];
  const uniqueBad = Array.from(new Set(badLinks));
  if (uniqueBad.length > 0) {
    issues.push(
      `Liens de navigation incorrects (blanchissent la preview) : ${uniqueBad.slice(0, 4).join(' ')}. ` +
      `Remplacer par onclick="showPage('id'); return false;" href="#"`
    );
  }

  // 3. showPage() function missing while site has multiple sections
  const sectionCount = (html.match(/<section/gi) || []).length;
  if (sectionCount > 1 && !html.match(/function\s+showPage\s*\(/)) {
    issues.push('Fonction showPage() absente du <script> alors que le site a ' + sectionCount + ' sections');
  }

  // 4. Literal \n artifacts from JSON string unescaping
  const literalN = (html.match(/\\n/g) || []).length;
  if (literalN > 8) issues.push(`${literalN} séquences \\n littérales dans le HTML (artéfacts JSON non désérialisés)`);

  // 5. Broken image src
  const brokenSrc = (html.match(/src=["'](?:#|"|''|\.\/img|\/img|image\.png|photo\.jpg|placeholder)/gi) || []).length;
  if (brokenSrc > 0) issues.push(`${brokenSrc} image(s) avec src cassé (utiliser https://images.unsplash.com/...)`);

  // 6. Empty onclick or javascript:void
  const voidLinks = (html.match(/href="javascript:void/gi) || []).length;
  if (voidLinks > 3) issues.push(`${voidLinks} liens javascript:void(0) sans onclick défini`);

  return issues;
}

/**
 * Extracts the first well-balanced JSON object from a string.
 * Handles cases where the LLM wraps the JSON in markdown or adds trailing text.
 */
function extractJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === "\\" && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Structured pipeline logger — always visible in Render logs */
function pipelineLog(step: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
  const payload = data && Object.keys(data).length > 0
    ? ' ' + Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    : '';
  console.log(`[maria:${ts}] ${step}${payload}`);
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

/**
 * Returns a platform-managed API key for the given provider.
 * Priority: DB table (admin-managed) → env var fallback → null
 */
async function getPlatformKey(provider: "anthropic" | "openai" | "deepseek" | "qwen"): Promise<string | null> {
  // 1. Try DB-stored key (admin can set/revoke via UltraDashboard)
  try {
    const db = await getDb();
    if (db) {
      const row = await db.select({ encryptedKey: platformApiKeys.encryptedKey })
        .from(platformApiKeys)
        .where(and(
          eq(platformApiKeys.provider, provider),
          eq(platformApiKeys.isActive, true)
        ))
        .limit(1);
      if (row[0]) {
        return decrypt(row[0].encryptedKey);
      }
    }
  } catch { /* DB unavailable — fall through to env var */ }

  // 2. Fall back to environment variable
  const envKeys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    deepseek:  process.env.DEEPSEEK_API_KEY,
    qwen:      process.env.QWEN_API_KEY,
  };
  return envKeys[provider] || null;
}

/** Non-streaming AI call — returns text + token counts */
async function callSync(
  provider: "anthropic" | "openai" | "deepseek" | "qwen",
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800
): Promise<LlmResult> {
  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
    });
    if (!r.ok) throw new Error(`${provider} sync error: ${await r.text()}`);
    const d = await r.json() as any;
    return {
      text: d.content?.[0]?.text || "",
      inputTokens: d.usage?.input_tokens || 0,
      outputTokens: d.usage?.output_tokens || 0,
    };
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
    return {
      text: d.choices?.[0]?.message?.content || "",
      inputTokens: d.usage?.prompt_tokens || 0,
      outputTokens: d.usage?.completion_tokens || 0,
    };
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
): Promise<LlmResult | null> {
  const t0 = Date.now();
  try {
    const result = await callSync(provider, model, apiKey, systemPrompt, userMessage, maxTokens);
    pipelineLog(`llm:ok`, { provider, model, in: result.inputTokens, out: result.outputTokens, ms: Date.now() - t0 });
    return result;
  } catch (err: any) {
    pipelineLog(`llm:error`, { provider, model, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 200) });
    return null;
  }
}

/**
 * Multi-agent orchestration — enriches the prompt with briefs from intermediate agents.
 * Each step logs tokens + estimated cost to usageLogs for the admin token counter.
 *
 * FREE:    DeepSeek seul
 * CREATOR: Qwen (stratégie) → DeepSeek (HTML)
 * PRO:     Claude (architecture) → Qwen (SEO/copy) → DeepSeek (HTML)
 * AGENCY:  GPT-4o (stratégie biz) → Claude (architecture+design) → Qwen (copy SEO) → DeepSeek (HTML)
 */
async function orchestrateGenerate(
  res: Response,
  db: Awaited<ReturnType<typeof getDb>>,
  userId: number,
  projectId: number,
  plan: string,
  prompt: string,
  siteType: string,
  style: string,
  language: string,
  colorPalette: string
): Promise<string> {
  let enriched = prompt;

  /** Emit progress, call agent, log tokens to DB, with automatic fallback */
  async function runStep(
    primary:  { provider: "anthropic"|"openai"|"deepseek"|"qwen"; model: string; key: string|null; agent: string; step: string; icon: string },
    fallback?: { provider: "anthropic"|"openai"|"deepseek"|"qwen"; model: string; key: string|null; agent: string; step: string; icon: string },
    systemPrompt = "",
    userMessage = "",
    maxTokens = 800
  ): Promise<LlmResult | null> {
    // ── Try primary agent ────────────────────────────────────────────────────
    if (primary.key) {
      const t0 = Date.now();
      sseWrite(res, "progress", { agent: primary.agent, step: primary.step, icon: primary.icon });
      const result = await tryCallSync(primary.provider, primary.model, primary.key, systemPrompt, userMessage, maxTokens);
      if (result) {
        if (db) {
          const cost = estimateCost(primary.model, result.inputTokens, result.outputTokens);
          await db.insert(usageLogs).values({
            userId, projectId,
            action: `agent:${primary.agent.toLowerCase()}`,
            model: primary.model,
            tokensUsed: result.inputTokens + result.outputTokens,
            durationMs: Date.now() - t0,
            status: "success" as const,
            costEstimateUsd: Math.round(cost * 1_000_000),
          }).catch(() => {});
        }
        return result;
      }
      sseWrite(res, "progress", { agent: primary.agent, step: `Indisponible — relais ${fallback?.agent ?? "ignoré"}`, icon: "⏭️" });
    }
    // ── Try fallback agent ───────────────────────────────────────────────────
    if (fallback?.key) {
      const t1 = Date.now();
      sseWrite(res, "progress", { agent: fallback.agent, step: fallback.step, icon: fallback.icon });
      const result = await tryCallSync(fallback.provider, fallback.model, fallback.key, systemPrompt, userMessage, maxTokens);
      if (result) {
        if (db) {
          const cost = estimateCost(fallback.model, result.inputTokens, result.outputTokens);
          await db.insert(usageLogs).values({
            userId, projectId,
            action: `agent:${fallback.agent.toLowerCase()}:relay`,
            model: fallback.model,
            tokensUsed: result.inputTokens + result.outputTokens,
            durationMs: Date.now() - t1,
            status: "success" as const,
            costEstimateUsd: Math.round(cost * 1_000_000),
          }).catch(() => {});
        }
        return result;
      }
      sseWrite(res, "progress", { agent: fallback.agent, step: "Indisponible — étape ignorée", icon: "⏭️" });
    }
    return null;
  }

  // ── Keys (fetched concurrently from DB / env) ─────────────────────────────
  const [claudeKey, openaiKey, qwenKey] = await Promise.all([
    getPlatformKey("anthropic"),
    getPlatformKey("openai"),
    getPlatformKey("qwen"),
  ]);

  // ── CREATOR: Qwen stratégie de contenu → DeepSeek HTML ───────────────────
  if (plan === "creator") {
    const brief = await runStep(
      { provider: "qwen",      model: "qwen-plus",       key: qwenKey,   agent: "Qwen",   step: "Analyse & stratégie de contenu", icon: "🧠" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Stratégie de contenu (relais)",  icon: "🧠" },
      `Tu es un expert en stratégie web. Produis un brief structuré: sections, proposition de valeur, mots-clés SEO. 150 mots max. Langue: ${language}.`,
      `Demande: ${prompt}\nType: ${siteType}\nStyle: ${style}\nPalette: ${colorPalette}`,
      600
    );
    if (brief) enriched = `${prompt}\n\n[BRIEF STRATÉGIQUE]:\n${brief.text}`;

  // ── PRO: Claude architecture → Qwen SEO/copy → DeepSeek HTML ────────────
  } else if (plan === "pro") {
    const architecture = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Architecture & structure du site", icon: "🏗️" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Architecture (relais)",            icon: "🏗️" },
      `Tu es un architecte web senior. Définis la structure optimale: sections, UX flow, points de conversion. 200 mots max. Langue: ${language}.`,
      `Demande: ${prompt}\nType: ${siteType}\nStyle: ${style}`,
      800
    );
    if (architecture) enriched = `${prompt}\n\n[ARCHITECTURE]:\n${architecture.text}`;

    const seo = await runStep(
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Optimisation contenu & SEO",    icon: "📈" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Optimisation SEO (relais)",      icon: "📈" },
      `Tu es un expert SEO et copywriting. Propose textes optimisés, titres accrocheurs, CTAs, méta-descriptions. 250 mots max. Langue: ${language}.`,
      enriched,
      900
    );
    if (seo) enriched = `${enriched}\n\n[COPY & SEO]:\n${seo.text}`;

  // ── AGENCY: GPT-4o stratégie → Claude architecture → Qwen copy → DeepSeek
  } else if (plan === "agency") {
    const strategy = await runStep(
      { provider: "openai",    model: "gpt-4o-mini",      key: openaiKey, agent: "GPT-4o", step: "Stratégie business & positionnement", icon: "🎯" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Stratégie business (relais)",          icon: "🎯" },
      `Tu es un consultant business senior. Définis: positionnement, audience cible, proposition de valeur, messages clés. 200 mots max. Langue: ${language}.`,
      `Projet: ${prompt}\nType: ${siteType}\nStyle: ${style}\nPalette: ${colorPalette}`,
      800
    );
    if (strategy) enriched = `${prompt}\n\n[STRATÉGIE BUSINESS]:\n${strategy.text}`;

    const architecture = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Architecture & design system", icon: "🏗️" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Architecture (relais)",        icon: "🏗️" },
      `Tu es un architecte web et designer senior. Définis: structure des sections, hiérarchie visuelle, composants clés. 250 mots max. Langue: ${language}.`,
      enriched,
      1000
    );
    if (architecture) enriched = `${enriched}\n\n[ARCHITECTURE & DESIGN]:\n${architecture.text}`;

    const copy = await runStep(
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Copywriting & optimisation SEO", icon: "✍️" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Copywriting (relais)",            icon: "✍️" },
      `Tu es un expert SEO et copywriter senior. Génère les textes finaux: titres H1/H2, CTAs, méta-title/description. 300 mots max. Langue: ${language}.`,
      enriched,
      1000
    );
    if (copy) enriched = `${enriched}\n\n[COPY & SEO FINAL]:\n${copy.text}`;
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

    // Check monthly token limit (if set by admin)
    if (u?.monthlyTokensLimit) {
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const monthStats = await db.select({ total: sum(usageLogs.tokensUsed) })
        .from(usageLogs)
        .where(and(eq(usageLogs.userId, user.id), gte(usageLogs.createdAt, startOfMonth)));
      const monthTokensUsed = Number(monthStats[0]?.total || 0);
      if (monthTokensUsed >= u.monthlyTokensLimit) {
        res.status(403).json({
          error: `Limite mensuelle de tokens atteinte (${u.monthlyTokensLimit.toLocaleString()} tokens). Contactez l'administrateur.`,
        });
        return;
      }
    }

    // ── Platform DeepSeek key (final executor) — fall back to user key ────────
    const userPlan = u?.plan || "free";
    let deepseekKey = await getPlatformKey("deepseek");
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
        res, db, user.id, projectId, userPlan, prompt,
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

      const generateCost = estimateCost("deepseek-chat", inputTokens, outputTokens);
      await db.insert(usageLogs).values({
        userId: user.id,
        projectId,
        action: "generate",
        model: "deepseek-chat",
        tokensUsed,
        durationMs,
        costEstimateUsd: Math.round(generateCost * 1_000_000),
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
  // phase="reason"  → Raisonnement seul  → SSE event awaiting_validation
  // phase="execute" → Plan+Exec+Ctrl+Livraison+Suggestions → SSE stream
  app.post("/api/stream/chat", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { projectId, message, phase = "reason", validatedSummary, images, consoleErrors } = req.body as {
      projectId: number;
      message: string;
      phase?: "reason" | "execute";
      validatedSummary?: string;
      images?: Array<{ base64: string; mimeType: string }>;
      consoleErrors?: string[];
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

    // Fetch user plan + all platform keys concurrently
    const [userRow, openaiKey, claudeKey, qwenKey, deepseekKeyPlatform] = await Promise.all([
      db.select().from(users).where(eq(users.id, user.id)).limit(1),
      getPlatformKey("openai"),
      getPlatformKey("anthropic"),
      getPlatformKey("qwen"),
      getPlatformKey("deepseek"),
    ]);
    const u = userRow[0];
    const userPlan = u?.plan || "free";
    const config = PLAN_CONFIGS[userPlan] || PLAN_CONFIGS.free;

    // Fallback: if no platform deepseek key, try user's stored key
    let deepseekKey = deepseekKeyPlatform;
    if (!deepseekKey) {
      const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
      if (keyRow[0]) {
        try { deepseekKey = decrypt(keyRow[0].encryptedKey); } catch { /* ignore */ }
      }
    }
    if (!deepseekKey) { res.status(400).json({ error: "Aucune clé API configurée" }); return; }

    const allKeys: Partial<Record<Provider, string | null>> = {
      openai: openaiKey, anthropic: claudeKey, qwen: qwenKey, deepseek: deepseekKey,
    };

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const fullCode = currentVersion[0].generatedCode || "";
    // 6000 chars gives the agent enough context to identify existing classes/functions/variables
    const codeSnippet = fullCode.slice(0, 6000);

    // ── PHASE 1: RAISONNEMENT ──────────────────────────────────────────────
    if (phase === "reason") {
      pipelineLog('reason:start', { project: project[0].name, plan: userPlan, consoleErrors: consoleErrors?.length || 0 });
      const reasonerSystemPrompt = `Tu es Mar-ia, experte en développement web. Avant de répondre, LIS ATTENTIVEMENT le code actuel du site et la demande de l'utilisateur.

ARCHITECTURE DU SITE (SPA mono-fichier HTML) — contexte obligatoire :
- Toutes les "pages" sont des <section id="page-id"> dans un seul fichier HTML
- Navigation inter-pages : onclick="showPage('page-id'); return false;" sur les liens ET le logo
- La fonction showPage(id) affiche la section demandée et cache toutes les autres
- Logo/marque → DOIT avoir onclick="showPage('accueil'); return false;" href="#"
- Liens nav → DOIVENT avoir onclick="showPage('xxx'); return false;" href="#"
- Un lien avec href="#hero" ou href="#features" est un BUG (blanchit la preview)

ÉTAPE 1 — CLASSIFICATION de la demande :
- Bug/Debug (affichage cassé, erreur, ne fonctionne pas) → analyser le code pour trouver les causes précises
- Modification visuelle (couleur, layout, style) → identifier les éléments CSS/HTML concernés
- Nouvelle fonctionnalité → comprendre le besoin exact
- Contenu (texte, images) → repérer les blocs à modifier

ÉTAPE 2 — ANALYSE DU CODE :
Lis le code fourni et identifie les éléments directement liés à la demande.
Pour un bug : cherche les erreurs concrètes (CSS manquant, JS cassé, balises mal fermées, responsive absent, liens href="#xxx" au lieu de showPage(), etc.)
Pour une modification : repère les sélecteurs, classes, IDs, onclick existants concernés.

ÉTAPE 3 — RÉSUMÉ STRUCTURÉ (120 mots max) au format :
**Demande :** [reformulation précise en 1-2 phrases]
**Diagnostic :** [ce que tu as trouvé dans le code — sois spécifique, cite les problèmes réels]
**Actions prévues :** [liste bullet des corrections/modifications concrètes]
**Périmètre :** [HTML / CSS / JS / Contenu]

⚠️ Ne réponds PAS à la va-vite. Prends le temps de lire le code et de diagnostiquer correctement.`;
      // If the client captured JS errors from the preview iframe, include them as diagnostic context
      const consoleCtxReason = consoleErrors && consoleErrors.length > 0
        ? `\n\n⚠️ ERREURS JS DÉTECTÉES DANS LE NAVIGATEUR (console de la preview) :\n${consoleErrors.slice(0, 8).map((e, i) => `${i + 1}. ${e}`).join('\n')}\nSi ces erreurs sont liées à la demande, inclus-les dans ton diagnostic et dans les actions prévues.`
        : '';
      const reasonerUserMsg = `Demande utilisateur: "${message}"\n\nCode actuel du site (${project[0].name}):\n${fullCode.slice(0, 8000)}${consoleCtxReason}`;

      // Try reasoner with automatic fallback if quota exceeded or error
      let reasoning: LlmResult | null = null;
      let usedReasoner = resolveKey(config.reasoner, allKeys);
      if (!usedReasoner) {
        sseWrite(res, "error", { message: "Aucun LLM disponible pour le raisonnement" });
        res.end(); return;
      }
      // Walk the fallback chain until one succeeds
      const startIdx = FALLBACK_CHAIN.indexOf(usedReasoner.provider);
      for (let i = startIdx; i < FALLBACK_CHAIN.length; i++) {
        const p = FALLBACK_CHAIN[i];
        const k = allKeys[p];
        if (!k) continue;
        sseWrite(res, "progress", { agent: AGENT_NAMES[p], step: "Analyse & compréhension de la demande…", icon: "🧠" });
        reasoning = await tryCallSync(p, PROVIDER_MODELS[p], k, reasonerSystemPrompt, reasonerUserMsg, 800);
        if (reasoning?.text) { usedReasoner = { provider: p, model: PROVIDER_MODELS[p], key: k }; break; }
      }

      pipelineLog('reason:done', { provider: usedReasoner.provider, tokens: reasoning?.inputTokens ? reasoning.inputTokens + reasoning.outputTokens : 0 });
      sseWrite(res, "awaiting_validation", {
        summary: reasoning?.text || `**Demande :** ${message}\n**Modifications :** À définir\n**Périmètre :** HTML`,
        originalMessage: message,
        agent: AGENT_NAMES[usedReasoner.provider],
      });
      res.end(); return;
    }

    // ── PHASE 2: EXECUTE ──────────────────────────────────────────────────
    if (phase === "execute") {
      const summary = validatedSummary || message;
      pipelineLog('execute:start', { project: project[0].name, plan: userPlan, consoleErrors: consoleErrors?.length || 0, summaryLen: summary.length });

      const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
      const totalVersions = versionCount[0]?.count || 0;

      await db.insert(chatMessages).values({ projectId, userId: user.id, role: "user", content: message });

      // No history for execute phase — system prompt already contains task + current code + plan.
      // History only causes confusion (old sessions, wrong tasks).
      const history: typeof chatMessages.$inferSelect[] = [];

      try {
        // ── A : Agent / Planning ────────────────────────────────────────
        let agentPlan = "";
        const agentLlm = resolveKey(config.agent, allKeys);
        if (agentLlm) {
          sseWrite(res, "progress", { agent: AGENT_NAMES[agentLlm.provider], step: "Planification des modifications…", icon: "🤖" });
          const plan = await tryCallSync(
            agentLlm.provider, agentLlm.model, agentLlm.key,
            `Tu es un architecte web expert. Analyse le code existant et produis un plan chirurgical précis (200 mots max).

PHASE 1 — LIS le code existant et repère :
• Variables CSS déjà définies (--color-primary, --font-main, etc.)
• Classes CSS existantes liées à la demande (réutilise-les, ne recrée pas)
• Fonctions JS déjà présentes (showPage, toggleMenu, etc.)
• IDs/sections HTML existants (ne les supprime pas)

PHASE 2 — PLAN CHIRURGICAL (touche UNIQUEMENT ce qui est demandé) :
• HTML : éléments exacts à ajouter/modifier avec les bonnes classes existantes
• CSS : propriétés précises à changer en réutilisant les variables CSS existantes
• JS : fonctions à créer/modifier en restant cohérent avec le code existant

RÈGLE ABSOLUE : Préserver toutes les features non concernées (animations, sections, formulaires…)
RÈGLE NAVIGATION : Logo/liens → onclick="showPage('id'); return false;" href="#" — jamais href="#section"`,
            `Résumé de la tâche: ${summary}\n\nCode actuel du site (extrait):\n${codeSnippet}`,
            800
          );
          if (plan) agentPlan = plan.text;
        }

        // ── B : Pré-exécution Qwen (Agency: 2 exécutants) ──────────────
        let qwenDraft = "";
        if (config.executors.length > 1) {
          const qwenLlm = resolveKey("qwen", allKeys);
          if (qwenLlm) {
            sseWrite(res, "progress", { agent: AGENT_NAMES[qwenLlm.provider], step: "Préparation des modifications…", icon: "⚙️" });
            const draft = await tryCallSync(
              qwenLlm.provider, qwenLlm.model, qwenLlm.key,
              `Tu es un développeur frontend expert. Génère les snippets précis à intégrer dans le code existant (pas le HTML complet).
Pour chaque snippet : indique l'emplacement exact (après quelle balise / dans quelle classe CSS / dans quelle fonction JS).
Réutilise les variables CSS et classes existantes. Respecte le style du code actuel.
NAVIGATION : onclick="showPage('id'); return false;" — jamais href="#quelquechose"`,
              `Plan: ${agentPlan}\nTâche: ${summary}\nCode existant:\n${codeSnippet}`,
              1200
            );
            if (draft) qwenDraft = draft.text;
          }
        }

        // ── C : Exécution streaming ─────────────────────────────────────
        const execProvider = config.executors[config.executors.length - 1];
        const execLlm = resolveKey(execProvider, allKeys);
        if (!execLlm) { sseWrite(res, "error", { message: "Aucun LLM d'exécution disponible" }); res.end(); return; }

        sseWrite(res, "progress", { agent: AGENT_NAMES[execLlm.provider], step: "Génération du code complet…", icon: "💻" });

        const systemPrompt = `Tu es Mar-ia, développeuse web senior. Tu travailles sur le projet "${project[0].name}".

TÂCHE : ${summary}

FORMAT DE RÉPONSE — UN SEUL JSON BRUT, RIEN AVANT, RIEN APRÈS :
• Modification du site → {"action":"modify","reply":"[1-2 phrases max]","code":"<!DOCTYPE html>..."}
• Question conversationnelle pure → {"action":"chat","reply":"[réponse]"}
⚠️ Tout changement visuel, ajout, correction → action="modify" OBLIGATOIRE.

══════════════════════════════════════════════
RÈGLES DE QUALITÉ — SANS EXCEPTION
══════════════════════════════════════════════

1. ANALYSE D'ABORD, CODE ENSUITE
   Lis le CODE ACTUEL ci-dessous. Identifie :
   • Les variables CSS déjà définies (--color-*, --font-*, etc.) → réutilise-les
   • Les classes CSS existantes → réutilise-les, ne recrée pas
   • Les fonctions JS existantes (showPage, toggleMenu, etc.) → réutilise-les
   • Les sections/pages déjà présentes → ne les supprime pas

2. MODIFICATION CHIRURGICALE
   Change UNIQUEMENT ce que la tâche demande.
   Préserve intégralement : animations, sections, formulaires, styles, couleurs, polices, JS existant.
   N'invente rien qui n'est pas demandé. N'efface rien qui fonctionne.

3. NAVIGATION showPage() — ARCHITECTURE SPA MONO-FICHIER
   • Logo/marque → <a href="#" onclick="showPage('accueil'); return false;">
   • Liens nav → <a href="#" onclick="showPage('page-id'); return false;">
   • Boutons CTA internes → onclick="showPage('page-id'); return false;"
   • ❌ INTERDIT : href="#hero", href="#section", href="#features" → blanchit la preview
   • showPage(id) DOIT toujours exister dans le <script>

4. CODE 100% COMPLET
   Retourne le fichier HTML entier. Jamais tronqué.
   Toutes les balises fermées : </style> </script> </body> </html>

5. MÉDIAS & FORMULAIRES
   • Images : https://images.unsplash.com/photo-ID?w=800&q=80
   • Formulaires : onsubmit avec e.preventDefault() + message de confirmation JS

══════════════════════════════════════════════
CODE ACTUEL (v${currentVersion[0].versionNumber}) — LIS-LE AVANT D'ÉCRIRE :
══════════════════════════════════════════════
${currentVersion[0].generatedCode || ""}
${agentPlan ? `\n══ PLAN D'ACTION ══\n${agentPlan}` : ""}${qwenDraft ? `\n\n══ SNIPPETS PRÉPARÉS ══\n${qwenDraft}` : ""}${consoleErrors && consoleErrors.length > 0 ? `\n\n══ ERREURS JS ACTIVES DANS LE SITE (console du navigateur) ══\n${consoleErrors.slice(0, 8).map((e, i) => `${i + 1}. ${e}`).join('\n')}\n⚠️ Corrige ces erreurs JS EN PLUS de la tâche principale. Elles proviennent du code actuel.` : ""}`;

        const llmMessages: Array<{ role: "user" | "assistant"; content: any }> = history
          .filter(m => m.content?.trim())
          .map(m => ({ role: m.role as "user" | "assistant", content: m.content || "" }));

        if (images && images.length > 0) {
          // Remove last user message if present (will be replaced with image+text)
          if (llmMessages.length > 0 && llmMessages[llmMessages.length - 1].role === "user") {
            llmMessages.pop();
          }
          const imageBlocks = images.map(img => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType as any, data: img.base64 } }));
          llmMessages.push({ role: "user", content: [...imageBlocks, { type: "text", text: summary }] });
        } else if (llmMessages.length > 0 && llmMessages[llmMessages.length - 1].role === "user") {
          // Replace last user message with validated summary
          const last = llmMessages[llmMessages.length - 1];
          if (typeof last.content === "string") last.content = summary;
        } else {
          // History is empty (most common case) — always push summary as user message
          llmMessages.push({ role: "user", content: summary });
        }

        const startTime = Date.now();
        let fullRaw = ""; let inputTokens = 0; let outputTokens = 0;

        if (execLlm.provider === "anthropic") {
          const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": execLlm.key, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31", "content-type": "application/json" },
            body: JSON.stringify({ model: execLlm.model, max_tokens: 16000, temperature: 0.3, stream: true, system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }], messages: llmMessages }),
          });
          if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur API: ${await aiRes.text()}` }); res.end(); return; }
          const reader = aiRes.body.getReader(); const dec = new TextDecoder(); let buf = "";
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop() || "";
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
          const baseUrls: Record<string, string> = { deepseek: "https://api.deepseek.com/v1", openai: "https://api.openai.com/v1", qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
          const baseUrl = baseUrls[execLlm.provider] || "https://api.openai.com/v1";
          const wrappedMessages = llmMessages.map(m => m.role === "assistant" ? { ...m, content: `{"action":"chat","reply":${JSON.stringify(m.content)}}` } : m);
          const aiRes = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${execLlm.key}`, "content-type": "application/json" },
            body: JSON.stringify({ model: execLlm.model, max_tokens: 16000, temperature: 0.3, stream: true, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, ...wrappedMessages] }),
          });
          if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur ${execLlm.provider}: ${await aiRes.text()}` }); res.end(); return; }
          const reader = aiRes.body.getReader(); const dec = new TextDecoder(); let buf = "";
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop() || "";
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

        const durationMs = Date.now() - startTime;
        const tokensUsed = inputTokens + outputTokens;

        // Parse JSON response — robust fallback for literal newlines/malformed JSON
        let agentResponse: { action: string; code?: string; reply: string };
        try { agentResponse = JSON.parse(fullRaw.trim()); }
        catch {
          try { agentResponse = JSON.parse(extractJsonObject(fullRaw) ?? fullRaw); }
          catch {
            // Final fallback: extract fields with regex (handles unescaped newlines in code field)
            const actionMatch = fullRaw.match(/"action"\s*:\s*"(\w+)"/);
            const replyMatch = fullRaw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            const htmlStart = fullRaw.search(/<!DOCTYPE html>/i);
            let extractedCode: string | undefined;
            if (htmlStart >= 0) {
              const tail = fullRaw.slice(htmlStart);
              const htmlEnd = tail.lastIndexOf('</html>');
              extractedCode = htmlEnd >= 0 ? tail.slice(0, htmlEnd + 7) : tail.replace(/["}\s]+$/, '');
            }
            // Unescape JSON string sequences in extracted HTML (regex path doesn't go through JSON.parse)
            if (extractedCode) {
              extractedCode = extractedCode
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\r/g, '')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            }
            agentResponse = {
              action: extractedCode ? "modify" : (actionMatch?.[1] || "chat"),
              reply: replyMatch?.[1]?.replace(/\\n/g, '\n').replace(/\\"/g, '"') || (extractedCode ? "Modification effectuée." : fullRaw.slice(0, 300)),
              code: extractedCode,
            };
          }
        }
        pipelineLog('execute:parsed', { plan: userPlan, action: agentResponse.action, hasCode: !!agentResponse.code, codeLen: agentResponse.code?.length || 0 });

        // ── D : Validation + boucle auto-correction (max 2 passes) ────
        if (agentResponse.action === "modify" && agentResponse.code) {
          const controlLlm = resolveKey(config.controller, allKeys);

          for (let pass = 1; pass <= 2; pass++) {
            // ── D1 : Validateur statique (gratuit, instantané) ─────────
            const staticIssues = validateGeneratedCode(agentResponse.code!);
            pipelineLog(`validate:static:pass${pass}`, { plan: userPlan, issues: staticIssues.length, detail: staticIssues });

            // ── D2 : LLM contrôleur (analyse sémantique) ──────────────
            let llmIssues = "";
            if (controlLlm) {
              sseWrite(res, "progress", { agent: AGENT_NAMES[controlLlm.provider], step: `Vérification qualité (passe ${pass})…`, icon: "🔍" });
              const ctrl = await tryCallSync(
                controlLlm.provider, controlLlm.model, controlLlm.key,
                `Tu es un expert QA développement web. Inspecte ce code HTML/CSS/JS et liste les problèmes CONCRETS trouvés.
Réponds UNIQUEMENT "OK" si tout est correct. Sinon, liste chaque problème sur une ligne (80 mots max total).

Vérifie :
- href="#quelquechose" sur les liens de nav/logo → doit être onclick="showPage('id'); return false;"
- Fonction showPage() présente si plusieurs sections
- Balises non fermées : </style> </script> </body> </html>
- JS incomplet ou cassé (accolades manquantes, fonctions tronquées)
- Code HTML tronqué
- Animations/features du code original supprimées par erreur`,
                (agentResponse.code || "").slice(0, 10000), 400
              );
              if (ctrl && ctrl.text.trim() !== "OK") llmIssues = ctrl.text.trim();
            }

            // Combine all detected issues
            const allIssues = [
              ...staticIssues,
              ...(llmIssues ? [llmIssues] : []),
            ];

            if (allIssues.length === 0) {
              pipelineLog(`validate:pass${pass}:ok`);
              break; // Code is clean, no retry needed
            }

            // ── D3 : Auto-correction avec feedback précis ─────────────
            pipelineLog(`validate:pass${pass}:issues`, { count: allIssues.length, issues: allIssues });
            if (pass === 2) {
              pipelineLog('validate:max_retries', { message: 'livraison avec code actuel' });
              break;
            }

            sseWrite(res, "progress", { agent: AGENT_NAMES[execLlm.provider], step: `Correction auto (passe ${pass})…`, icon: "🔄" });
            const correctionPrompt = `${systemPrompt}

══ PROBLÈMES DÉTECTÉS DANS TON CODE — CORRIGE-LES TOUS ══
${allIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Retourne le JSON complet corrigé {"action":"modify","reply":"...","code":"..."}`;

            const retry = await tryCallSync(execLlm.provider, execLlm.model, execLlm.key, correctionPrompt, summary, 16000);
            if (!retry) break;

            // Parse corrected response
            let corrected: { action: string; code?: string; reply: string } | null = null;
            try { corrected = JSON.parse(retry.text.trim()); }
            catch {
              try { corrected = JSON.parse(extractJsonObject(retry.text) ?? retry.text); }
              catch {
                const htmlStart = retry.text.search(/<!DOCTYPE html>/i);
                if (htmlStart >= 0) {
                  const tail = retry.text.slice(htmlStart);
                  const htmlEnd = tail.lastIndexOf('</html>');
                  const code = (htmlEnd >= 0 ? tail.slice(0, htmlEnd + 7) : tail)
                    .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                  corrected = { action: "modify", reply: agentResponse.reply, code };
                }
              }
            }
            if (corrected?.code) {
              agentResponse = corrected;
              pipelineLog(`validate:pass${pass}:corrected`, { codeLen: corrected.code.length });
            } else {
              pipelineLog(`validate:pass${pass}:correction_parse_failed`);
              break;
            }
          }
        }

        // ── E : Sauvegarde version ─────────────────────────────────────
        let versionId: number | null = null;
        const _allUsed = [config.agent, ...config.executors, config.controller].map(p => PROVIDER_MODELS[p]);
        const usedModels = _allUsed.filter((v, i) => _allUsed.indexOf(v) === i).join("+");

        if (agentResponse.action === "modify" && agentResponse.code) {
          const nextVersionNumber = totalVersions + 1;
          const [versionResult] = await db.insert(versions).values({
            projectId, userId: user.id,
            versionNumber: nextVersionNumber,
            label: `Version ${nextVersionNumber} — ${message.slice(0, 50)}`,
            prompt: message, generatedCode: agentResponse.code,
            tokensUsed, generationTimeMs: durationMs,
            model: usedModels || execLlm.model, status: "ready",
          }).returning({ id: versions.id });
          versionId = versionResult.id;
          await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, projectId));
        }

        // ── F : Livraison ──────────────────────────────────────────────
        const assistantReply = agentResponse.reply || "Modification effectuée.";
        await db.insert(chatMessages).values({
          projectId, userId: user.id, role: "assistant",
          content: assistantReply, versionId: versionId || undefined, tokensUsed,
        });

        pipelineLog('execute:done', { plan: userPlan, action: agentResponse.action, tokensUsed, durationMs, versionId });
        sseWrite(res, "done", {
          versionId, tokensUsed, reply: assistantReply,
          action: agentResponse.action, generatedCode: agentResponse.code || null,
        });

        // ── G : Suggestions A/B/C ──────────────────────────────────────
        const suggesterLlm = resolveKey(config.suggester, allKeys);
        if (suggesterLlm) {
          const suggestResult = await tryCallSync(
            suggesterLlm.provider, suggesterLlm.model, suggesterLlm.key,
            `Tu es Mar-ia. Propose 3 évolutions pertinentes pour ce site suite à la modification. Format JSON STRICT:
[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."}]
Chaque suggestion: 6-10 mots, actionnable et concrète. Pas de guillemets dans le texte.`,
            `Projet: ${project[0].name}\nModification: ${assistantReply.slice(0, 200)}`,
            300
          );
          if (suggestResult) {
            try {
              const extracted = extractJsonObject(suggestResult.text);
              const suggestions = JSON.parse(extracted ?? suggestResult.text);
              if (Array.isArray(suggestions)) sseWrite(res, "suggestions", { suggestions });
            } catch { /* skip */ }
          }
        }

      } catch (err: any) {
        sseWrite(res, "error", { message: err.message });
      }

      res.end();
      return;
    }

    res.status(400).json({ error: "Phase inconnue. Utilisez 'reason' ou 'execute'." });
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
    const platformDebugKey = await getPlatformKey("anthropic");
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

      const debugCost = estimateCost(modelToUse, inputTokens, outputTokens);
      await db.insert(usageLogs).values({
        userId: user.id,
        projectId,
        action: "debug",
        model: modelToUse,
        tokensUsed,
        durationMs,
        costEstimateUsd: Math.round(debugCost * 1_000_000),
        status: "success",
      }).catch(() => {});

      sseWrite(res, "done", { versionId: versionResult.id, report, tokensUsed });
    } catch (err: any) {
      sseWrite(res, "error", { message: err.message });
    }

    res.end();
  });

  // ── POST /api/stream/suggestions ─────────────────────────────────────────
  // Génère 3 suggestions contextuelles après chaque action (generate / chat / debug)
  app.post("/api/stream/suggestions", async (req: Request, res: Response) => {
    try {
      const { context = "", lastAction = "generate", language = "fr" } = req.body || {};
      const apiKey = await getPlatformKey("deepseek");
      if (!apiKey) return res.json({ suggestions: [] });

      const langLabel = language === "en" ? "English" : language === "es" ? "español" : "français";

      const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          max_tokens: 150,
          temperature: 0.85,
          messages: [
            {
              role: "system",
              content: `Tu es un assistant web design expert. Réponds UNIQUEMENT avec un tableau JSON de exactement 3 suggestions courtes et actionnables (6 mots max chacune) en ${langLabel}. Chaque suggestion doit être différente et utile. Format strict : ["suggestion 1", "suggestion 2", "suggestion 3"]`,
            },
            {
              role: "user",
              content: `Contexte du site : ${String(context).slice(0, 400)}\nAction effectuée : ${lastAction}\nProposes 3 améliorations concrètes.`,
            },
          ],
        }),
      });

      if (!r.ok) return res.json({ suggestions: [] });
      const d = await r.json() as any;
      const text: string = d.choices?.[0]?.message?.content || "[]";
      const match = text.match(/\[[\s\S]*?\]/);
      const suggestions = match ? JSON.parse(match[0]).slice(0, 3) : [];
      res.json({ suggestions });
    } catch {
      res.json({ suggestions: [] });
    }
  });
}
