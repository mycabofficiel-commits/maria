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
import { buildInspirationContext } from "./inspiration";

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
  openai:    "gpt-4o",           // upgraded from gpt-4o-mini — quality reasoning
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

  // 7. GHOST PAGES — showPage() targets without matching <section id="...">
  //    This is the most common silent bug: nav links call showPage('services') but
  //    <section id="services"> doesn't exist → blank page on click.
  const showPageTargets = Array.from(new Set(
    (html.match(/showPage\s*\(\s*['"]([^'"]+)['"]\s*\)/gi) || [])
      .map(m => { const r = m.match(/showPage\s*\(\s*['"]([^'"]+)['"]/i); return r ? r[1] : null; })
      .filter(Boolean) as string[]
  ));
  if (showPageTargets.length > 0) {
    const missingPages: string[] = [];
    const emptyPages: string[] = [];
    for (const pageId of showPageTargets) {
      // Check element with this id exists
      const elRe = new RegExp(`<(?:section|div|main|article)[^>]+id=["']${pageId}["']`, 'i');
      if (!elRe.test(html)) {
        missingPages.push(pageId);
      } else {
        // Check it has meaningful content (strip tags, count text chars)
        const contentRe = new RegExp(`<(?:section|div|main|article)[^>]+id=["']${pageId}["'][^>]*>([\\s\\S]*?)<\\/(?:section|div|main|article)>`, 'i');
        const contentM = html.match(contentRe);
        if (contentM) {
          const text = contentM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length < 80) emptyPages.push(pageId);
        }
      }
    }
    if (missingPages.length > 0) {
      issues.push(
        `PAGES FANTÔMES — ${missingPages.length} page(s) appelée(s) par showPage() n'ont PAS de section HTML : ` +
        missingPages.map(p => `id="${p}"`).join(', ') +
        `. Créer <section id="${missingPages[0]}">...</section> avec du vrai contenu pour chacune.`
      );
    }
    if (emptyPages.length > 0) {
      issues.push(
        `PAGES VIDES — ${emptyPages.length} page(s) existent mais sont quasi-vides : ` +
        emptyPages.map(p => `id="${p}"`).join(', ') +
        `. Ajouter du vrai contenu HTML dans chaque section.`
      );
    }
  }

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

/**
 * Vision-capable sync call — only for Anthropic (Claude) which supports images.
 * Used in the reasoner when the user attaches screenshots or photos.
 */
async function callSyncVision(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  images: Array<{ base64: string; mimeType: string }>,
  maxTokens = 1000
): Promise<LlmResult> {
  const imageBlocks = images.map(img => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: img.mimeType as any, data: img.base64 },
  }));
  const userContent = [...imageBlocks, { type: "text" as const, text: userMessage }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, system: systemPrompt, messages: [{ role: "user", content: userContent }] }),
  });
  if (!r.ok) throw new Error(`vision sync error: ${await r.text()}`);
  const d = await r.json() as any;
  return {
    text: d.content?.[0]?.text || "",
    inputTokens: d.usage?.input_tokens || 0,
    outputTokens: d.usage?.output_tokens || 0,
  };
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
  const isMobileApp = siteType === "Application mobile";
  // For mobile apps, prefix the prompt so orchestrators produce app-specific briefs
  let enriched = isMobileApp
    ? `[APPLICATION MOBILE iOS/ANDROID] ${prompt}\n\nNote pour les agents : génère un brief pour une APP MOBILE (pas un site web). Les sections = écrans de l'app (Accueil, Catalogue, Détail, Profil…), les CTAs = boutons mobiles, le design = style app native.`
    : prompt;

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
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Analyse & stratégie de contenu", icon: "🧠" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Stratégie de contenu (relais)",  icon: "🧠" },
      `Tu es un expert en stratégie web et UX. Analyse la demande et produis un brief ACTIONNABLE pour le développeur.

FORMAT OBLIGATOIRE :
SECTIONS: [liste toutes les sections/pages du site, ex: Accueil | Services | Tarifs | Contact]
TITRE_H1: [titre accrocheur pour le héros]
SOUS_TITRE: [sous-titre du héros, 1 phrase valeur unique]
COULEURS: [précise comment utiliser la palette ${colorPalette}]
CTA_PRINCIPAL: [texte du bouton d'appel à l'action]
MOTS_CLES: [5 mots-clés SEO principaux]
CONTENU_SPECIFIQUE: [3-5 points de contenu spécifiques au domaine métier, avec exemples concrets]
Langue finale: ${language}.`,
      `Demande: ${prompt}\nType: ${siteType}\nStyle: ${style}\nPalette: ${colorPalette}`,
      1000
    );
    if (brief) enriched = `${prompt}\n\n[BRIEF STRATÉGIQUE]:\n${brief.text}`;

  // ── PRO: Claude architecture → Qwen SEO/copy → DeepSeek HTML ────────────
  } else if (plan === "pro") {
    const architecture = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Architecture & structure du site", icon: "🏗️" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Architecture (relais)",            icon: "🏗️" },
      `Tu es un architecte web senior. Analyse la demande et produis un plan DÉTAILLÉ et ACTIONNABLE.

FORMAT OBLIGATOIRE :
PAGES: [liste toutes les pages/sections avec leur id HTML, ex: accueil | services | processus | tarifs | avis | contact]
HERO: [titre H1 + sous-titre + 2 CTAs pour la section héros]
SECTIONS_DETAIL: [pour chaque section, liste 3-4 éléments de contenu spécifiques au domaine]
FONCTIONNALITES_JS: [liste les interactions JS nécessaires : accordion, slider, formulaire, etc.]
DESIGN_SYSTEM: [variables CSS recommandées selon palette ${colorPalette} : couleur primaire, secondaire, accent, bg]
SEO: [meta-title + meta-description optimisés]
Langue: ${language}.`,
      `Demande: ${prompt}\nType: ${siteType}\nStyle: ${style}`,
      1400
    );
    if (architecture) enriched = `${prompt}\n\n[ARCHITECTURE]:\n${architecture.text}`;

    const seo = await runStep(
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Copywriting & SEO",             icon: "📈" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Copywriting SEO (relais)",       icon: "📈" },
      `Tu es un expert SEO et copywriter. Génère les textes FINAUX prêts à intégrer dans le HTML (pas de suggestions, du vrai contenu).

Pour chaque section identifiée dans le plan, fournis :
• Titre H2 accrocheur
• Texte de description (2-3 phrases, ton ${style.toLowerCase()})
• Contenu spécifique au domaine (PAS de texte générique)
• CTA si applicable
Langue: ${language}. Adapte le vocabulaire au secteur d'activité précis.`,
      enriched,
      1500
    );
    if (seo) enriched = `${enriched}\n\n[COPY & SEO]:\n${seo.text}`;

  // ── AGENCY: GPT-4o stratégie → Claude architecture → Qwen copy → synthèse
  } else if (plan === "agency") {
    const strategy = await runStep(
      { provider: "openai",    model: "gpt-4o",            key: openaiKey, agent: "GPT-4o", step: "Stratégie business & positionnement", icon: "🎯" },
      { provider: "anthropic", model: "claude-haiku-4-5",  key: claudeKey, agent: "Claude", step: "Stratégie business (relais)",          icon: "🎯" },
      `Tu es un consultant business senior spécialisé dans le digital. Analyse ce projet et produis une stratégie PRÉCISE et OPÉRATIONNELLE.

FORMAT OBLIGATOIRE :
POSITIONNEMENT: [en 1 phrase claire: qui est le client, ce qu'il offre, pourquoi choisir ce service]
AUDIENCE_CIBLE: [profil client précis : âge, besoin, comportement, zone géographique si pertinent]
PROPOSITION_VALEUR: [3 arguments clés de différenciation, spécifiques au secteur]
MESSAGES_CLES: [3 messages marketing percutants à répéter sur le site]
SECTIONS_PRIORITAIRES: [liste ordonnée des 6-8 sections/pages indispensables avec leur rôle business]
POINTS_CONVERSION: [où placer les CTAs et lesquels pour maximiser les conversions]
CREDIBILITE: [éléments de preuve sociale à inclure : témoignages, chiffres, certifications, partenaires]
Langue finale: ${language}.`,
      `Projet: ${prompt}\nType: ${siteType}\nStyle: ${style}\nPalette: ${colorPalette}`,
      1500
    );
    if (strategy) enriched = `${prompt}\n\n[STRATÉGIE BUSINESS]:\n${strategy.text}`;

    const architecture = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Architecture & design system", icon: "🏗️" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Architecture (relais)",        icon: "🏗️" },
      `Tu es un architecte web et designer UI/UX senior. À partir de la stratégie fournie, définis l'architecture technique et visuelle COMPLÈTE.

FORMAT OBLIGATOIRE :
PAGES_HTML: [liste avec id HTML exact pour chaque page/section, ex: accueil, services, processus, tarifs, avis, contact]
HERO_CONTENU: [titre H1 exact + sous-titre + bouton CTA1 + bouton CTA2]
DESIGN_SYSTEM:
  --c-primary: [hex de la couleur principale selon palette ${colorPalette}]
  --c-secondary: [hex secondaire]
  --c-accent: [hex accent]
  --c-bg: [hex fond]
  --font-display: [police titres Google Fonts]
  --font-body: [police corps Google Fonts]
SECTIONS_DETAIL: [pour chaque page, liste 4-6 composants HTML concrets à créer]
IMAGES_SUGGESTIONS: [thème Unsplash pour chaque section visuelle]
JS_INTERACTIONS: [liste toutes les interactions nécessaires : menu mobile, accordion, slider, formulaire, animations]
Langue: ${language}.`,
      enriched,
      1800
    );
    if (architecture) enriched = `${enriched}\n\n[ARCHITECTURE & DESIGN]:\n${architecture.text}`;

    const copy = await runStep(
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Copywriting & SEO final", icon: "✍️" },
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Copywriting (relais)",     icon: "✍️" },
      `Tu es un copywriter expert et consultant SEO. Génère TOUS les textes finaux du site, prêts à coller dans le HTML.

Pour chaque section/page identifiée dans l'architecture, fournis :
• Titre H2 exact (accrocheur, avec mots-clés SEO)
• Corps de texte (2-4 phrases percutantes, ton ${style.toLowerCase()}, contenu 100% spécifique au domaine — JAMAIS de lorem ipsum)
• Contenu spécifique : liste de services, étapes d'un processus, FAQ, témoignages fictifs réalistes, etc.
• CTA si la section en a besoin

ÉGALEMENT :
META_TITLE: [60 caractères max, avec mot-clé principal]
META_DESCRIPTION: [155 caractères max, accrocheur]
OG_TITLE: [pour réseaux sociaux]
Langue: ${language}. Vocabulaire professionnel et spécifique au secteur.`,
      enriched,
      2000
    );
    if (copy) enriched = `${enriched}\n\n[COPY & SEO FINAL]:\n${copy.text}`;

    // ── SYNTHÈSE FINALE : Claude fusionne tous les briefs en 1 master brief ─
    const synthesis = await runStep(
      { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey, agent: "Claude", step: "Synthèse finale du brief…", icon: "📋" },
      { provider: "qwen",      model: "qwen-plus",        key: qwenKey,   agent: "Qwen",   step: "Synthèse (relais)",         icon: "📋" },
      `Tu es Mar-ia, cheffe de projet web. Tu reçois plusieurs briefs d'experts (stratégie, architecture, copy).
Ton rôle : fusionner ces briefs en UN SEUL document clair et structuré pour le développeur final.

Le document de synthèse DOIT contenir dans l'ordre :
1. DESCRIPTION_PROJET: [1 paragraphe résumant le projet, son audience, son positionnement]
2. PAGES_A_CREER: [liste complète des sections HTML avec leur id et leur rôle]
3. DESIGN_SYSTEM: [variables CSS finales --c-primary --c-secondary --c-accent --c-bg --font-display --font-body]
4. CONTENU_SECTION_PAR_SECTION: [pour chaque section : titre H2, texte, éléments, CTA]
5. META_SEO: [meta-title, meta-description, og:title]
6. JS_REQUIS: [liste des interactions JS à implémenter]

Sois PRÉCIS et COMPLET. Ce document sera utilisé directement pour générer le HTML final.`,
      enriched,
      2500
    );
    if (synthesis?.text && synthesis.text.length > 500) {
      // Replace all intermediate briefs with the synthesis — cleaner for DeepSeek
      enriched = `${prompt}\n\n[MASTER BRIEF — SYNTHÈSE COMPLÈTE]:\n${synthesis.text}`;
    }
  }

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── EXPO REACT NATIVE GENERATOR ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

async function generateExpoApp(
  res: Response,
  db: Awaited<ReturnType<typeof getDb>>,
  user: { id: number },
  u: { plan?: string; generationsUsed?: number } | undefined,
  projectId: number,
  projectName: string,
  prompt: string,
  siteType: string | undefined,
  style: string | undefined,
  language: string | undefined,
  colorPalette: string | undefined,
  versionNumber: number,
  deepseekKey: string
): Promise<void> {
  const startTime = Date.now();
  let fullCode = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    sseWrite(res, "progress", { agent: "DeepSeek", step: "Génération de l'application React Native…", icon: "📱" });

    const systemPrompt = `Tu es Mar-ia, experte en développement d'applications mobiles React Native / Expo. Tu génères du code React Native complet, fonctionnel et moderne pour une application iOS et Android.

══ RÈGLES ABSOLUES (CRITIQUE — un seul écart = app qui crash) ══
• Fichier UNIQUE App.js — JavaScript UNIQUEMENT, pas TypeScript
• Commence EXACTEMENT par : import React, { useState, useEffect, useRef } from 'react';
• SEULS imports autorisés :
    - React Native built-ins : View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, SafeAreaView, StatusBar, FlatList, Modal, Alert, ActivityIndicator, Dimensions, Platform, Switch
    - Expo : import { LinearGradient } from 'expo-linear-gradient';  ← UNIQUEMENT ce package Expo
• INTERDIT ABSOLUMENT : react-native-svg, react-navigation, @react-navigation, expo-router, @expo/vector-icons, react-native-vector-icons, react-native-maps, react-native-reanimated, toute lib non listée ci-dessus
• Navigation : UNIQUEMENT via useState — PAS de librairie de navigation
• Icônes : UNIQUEMENT des emojis (✈️ 🏠 👤 ⚙️ ❤️ etc.) — jamais de composant Icon
• Export default function App() { ... }
• StyleSheet.create() pour TOUS les styles — 0 style inline sauf variables dynamiques
• JAMAIS de DOM (document, window, innerHTML, querySelector)
• Dimensions.get('window') pour les tailles adaptatives

══ ARCHITECTURE OBLIGATOIRE ══
1. const COLORS = { primary, secondary, bg, card, text, textMuted, border } — couleurs de la palette
2. Composants fonctionnels pour chaque écran : HomeScreen, ListScreen, DetailScreen, ProfileScreen
3. Composant BottomTabBar avec emojis comme icônes — TouchableOpacity par onglet
4. Composant App() principal avec useState pour l'écran actif
5. StatusBar barStyle="light-content" ou "dark-content" selon le fond

══ DESIGN PREMIUM ══
• Cards : borderRadius:16, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.08, shadowRadius:8, elevation:3
• Boutons principaux : height:52, borderRadius:26, backgroundColor:COLORS.primary
• TextInput : height:48, borderRadius:12, backgroundColor:'#f5f5f5', paddingHorizontal:16
• Spacing : 8, 12, 16, 20, 24, 32
• Tailles texte : 28 (h1), 22 (h2), 18 (h3), 15 (body), 12 (caption)
• LinearGradient pour les headers/boutons hero si besoin

══ CONTENU ══
• 4 écrans minimum avec vrai contenu métier (pas de lorem ipsum)
• Données fictives hardcodées réalistes : noms, prix, distances, dates, descriptions
• Photos : Image source={{uri:'https://images.unsplash.com/photo-ID?w=400&q=80'}}
• Contenu spécifique au domaine demandé

SDK: Expo 54 / React Native 0.76.7 | TYPE APP: ${siteType || "application mobile"} | STYLE: ${style || "moderne"} | LANGUE: ${language || "fr"} | PALETTE: ${colorPalette || "bleu/violet"}`;

    const userMessage = `Crée une application mobile React Native COMPLÈTE et PREMIUM pour : ${prompt}

STRUCTURE OBLIGATOIRE :
1. Imports React Native et Expo en haut du fichier
2. Constante COLORS avec toutes les couleurs de la palette
3. Composants pour chaque écran (HomeScreen, ListScreen, DetailScreen, ProfileScreen)
4. Composant BottomTabBar avec navigation entre les écrans
5. Composant App() principal avec useState pour gérer l'écran actif
6. StyleSheet.create({ ... }) avec TOUS les styles en bas du fichier

QUALITÉ ATTENDUE :
• Contenu SPÉCIFIQUE au domaine demandé (pas de template générique)
• Données fictives complètes et réalistes (noms, prix, descriptions, dates…)
• UI soignée : gradients, ombres, arrondis, espacements cohérents
• ScrollView dans les écrans longs
• FlatList pour les listes de données
• TouchableOpacity avec activeOpacity={0.8} sur tous les éléments cliquables
• SafeAreaView en wrapper principal

Retourne UNIQUEMENT le code JavaScript complet, sans explication, sans markdown, sans backticks.`;

    // Stream the React Native code from DeepSeek
    const aiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${deepseekKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 14000,
        temperature: 0.3,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
      }),
    });

    if (!aiRes.ok || !aiRes.body) {
      sseWrite(res, "error", { message: `Erreur DeepSeek Expo: ${await aiRes.text()}` });
      res.end();
      return;
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
          const chunk = evt.choices?.[0]?.delta?.content;
          if (chunk) { fullCode += chunk; sseWrite(res, "chunk", { text: chunk }); }
          if (evt.usage) { inputTokens = evt.usage.prompt_tokens || 0; outputTokens = evt.usage.completion_tokens || 0; }
        } catch { /* skip */ }
      }
    }

    // Clean potential markdown wrapping
    const jsStart = fullCode.indexOf("import React");
    if (jsStart > 0) fullCode = fullCode.slice(jsStart);
    if (fullCode.endsWith("```")) fullCode = fullCode.slice(0, -3).trim();

    const tokensUsed = inputTokens + outputTokens;
    const durationMs = Date.now() - startTime;

    // ── Save to Expo Snack (public API — no auth required) ─────────────────
    sseWrite(res, "progress", { agent: "Expo", step: "Publication sur Expo Snack…", icon: "🚀" });
    let snackUrl = "";
    let snackId = "";

    try {
      const snackRes = await fetch("https://exp.host/--/api/v2/snack/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest: {
            name: projectName,
            description: `Application générée par Mar-ia — ${siteType || "App mobile"}`,
            sdkVersion: "54.0.0",
          },
          code: {
            "App.js": { type: "CODE", contents: fullCode },
          },
          dependencies: {
            "expo": "~54.0.0",
            "react": "18.3.1",
            "react-native": "0.76.7",
            "expo-linear-gradient": "~14.0.1",
          },
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (snackRes.ok) {
        const snackData = await snackRes.json() as any;
        snackId = snackData.hashId || snackData.id || "";
        if (snackId) {
          snackUrl = `https://snack.expo.dev/${snackId}`;
          pipelineLog("expo:snack:saved", { snackId, snackUrl });
        } else {
          pipelineLog("expo:snack:no-id", { body: JSON.stringify(snackData).slice(0, 300) });
        }
      } else {
        const errBody = await snackRes.text().catch(() => "");
        pipelineLog("expo:snack:http-error", { status: snackRes.status, body: errBody.slice(0, 300) });
      }
    } catch (snackErr: any) {
      pipelineLog("expo:snack:error", { error: snackErr?.message });
    }

    // ── Persist to DB ──────────────────────────────────────────────────────
    if (!db) { sseWrite(res, "error", { message: "DB unavailable" }); res.end(); return; }

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
      previewUrl: snackUrl || undefined,
    }).where(eq(projects.id, projectId));

    await db.update(users)
      .set({ generationsUsed: (u?.generationsUsed || 0) + 1 })
      .where(eq(users.id, user.id));

    const generateCost = estimateCost("deepseek-chat", inputTokens, outputTokens);
    await db.insert(usageLogs).values({
      userId: user.id,
      projectId,
      action: "generate:expo",
      model: "deepseek-chat",
      tokensUsed,
      durationMs,
      costEstimateUsd: Math.round(generateCost * 1_000_000),
      status: "success",
    });

    sseWrite(res, "done", { versionId, tokensUsed, durationMs, snackUrl, snackId });

  } catch (err: any) {
    if (db) await db.update(projects).set({ status: "error" }).where(eq(projects.id, projectId));
    sseWrite(res, "error", { message: err.message });
  }

  res.end();
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerStreamingRoutes(app: Express) {

  // ── POST /api/expo/html-preview ───────────────────────────────────────────
  // Converts an App.js (React Native) to a mobile HTML preview for in-browser display
  app.post("/api/expo/html-preview", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { code, projectName = "App" } = req.body as { code: string; projectName?: string };
    if (!code) return res.status(400).json({ error: "code requis" });

    try {
      const deepseekKey = await getPlatformKey("deepseek");
      if (!deepseekKey) return res.status(503).json({ error: "Clé LLM manquante" });

      const aiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${deepseekKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          max_tokens: 900,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: `Convert React Native App.js to HTML. Output ONLY the raw HTML, no markdown, no explanation.
Rules: width:390px; overflow:hidden; position:relative; font-family:system-ui; margin:0.
Map View→div, Text→p/span/h2, TouchableOpacity→button. Copy real bg colors and text. Inline styles only, no CDN.
Generate ONLY the first visible screen (no scroll, no tab navigation needed).`
            },
            {
              role: "user",
              content: `App.js:\n\n${code.slice(0, 2500)}`
            }
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!aiRes.ok) return res.status(502).json({ error: "Erreur LLM" });
      const data = await aiRes.json() as any;
      let html = data.choices?.[0]?.message?.content || "";
      html = html.replace(/^```html\n?/i, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
      return res.json({ html });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

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

    // ── Fetch project to get framework ────────────────────────────────────
    const projectRow = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const projectFramework = projectRow[0]?.framework || "html";
    const projectName = projectRow[0]?.name || "App";

    // ══════════════════════════════════════════════════════════════════════
    // ── EXPO / REACT NATIVE PATH ─────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════
    if (projectFramework === "expo") {
      await generateExpoApp(res, db, user, u, projectId, projectName, prompt, siteType, style, language, colorPalette, versionNumber, deepseekKey);
      return;
    }

    // ── Keys needed for post-generation audit ─────────────────────────────
    const claudeKey = await getPlatformKey("anthropic");

    // ── Multi-agent orchestration (creator / pro / agency) ─────────────────
    let enrichedPrompt = prompt;
    try {
      enrichedPrompt = await orchestrateGenerate(
        res, db, user.id, projectId, userPlan, prompt,
        siteType || "landing page", style || "moderne",
        language || "fr", colorPalette || "bleu/violet moderne"
      );
    } catch { /* orchestration failed — continue with original prompt */ }

    // ── Inspiration URLs — scrape before building prompt ──────────────────
    const { cleanPrompt: finalPrompt, context: inspirationCtx } = await buildInspirationContext(enrichedPrompt).catch(() => ({ cleanPrompt: enrichedPrompt, context: "" }));

    // ── Final execution: DeepSeek streams the HTML ─────────────────────────
    const isMobileApp = siteType === "Application mobile";
    sseWrite(res, "progress", { agent: "DeepSeek", step: isMobileApp ? "Génération du prototype mobile…" : "Génération du code HTML…", icon: "💻" });

    const systemPrompt = isMobileApp
      ? `Tu es Mar-ia, experte en design d'applications mobiles. Tu génères un prototype interactif HTML/CSS/JS qui simule EXACTEMENT une vraie app mobile (iOS/Android) dans un cadre de téléphone.

══ STRUCTURE OBLIGATOIRE ══
• Fichier UNIQUE : <!DOCTYPE html>…</html> — CSS dans <style>, JS dans <script>
• Le corps de la page : fond sombre (#0f0f0f), centré, avec un cadre téléphone en CSS
• Google Fonts : Inter obligatoire (system font des apps mobiles)
• Viewport : width=device-width, initial-scale=1

══ CADRE TÉLÉPHONE (OBLIGATOIRE) ══
Le fond de page est sombre. Au centre : un cadre qui simule un iPhone/Android :
  .phone-frame {
    width: 390px; max-width: 100vw; height: 844px; max-height: 95vh;
    background: #fff; border-radius: 50px; overflow: hidden;
    box-shadow: 0 40px 80px rgba(0,0,0,.6), inset 0 0 0 2px #333;
    position: relative; display: flex; flex-direction: column;
  }
  .phone-notch { height: 44px; background: #000; border-radius: 0 0 20px 20px; width: 120px; margin: 0 auto; }
  .status-bar { display: flex; justify-content: space-between; padding: 8px 20px; font-size: 12px; font-weight: 600; background: var(--c-bg); }

══ NAVIGATION PAR ONGLETS (Bottom Tab Bar) ══
• Barre fixe en bas du cadre : 4 à 5 onglets avec icônes SVG + labels
• Onglet actif : couleur primaire, icône remplie ; inactifs : gris
• JS : switchTab(id) → cache .screen, montre #screen-{id}, update tab actif
• Écrans : .screen { display:none } → .screen.active { display:flex; flex-direction:column; flex:1; overflow-y:auto }

══ DESIGN SYSTEM MOBILE ══
:root {
  --c-primary: [couleur principale palette] ;
  --c-bg: #ffffff ; --c-bg-alt: #f8f9fa ; --c-surface: #f1f3f5 ;
  --c-text: #0a0a0a ; --c-text-muted: #6b7280 ; --c-border: #e5e7eb ;
  --radius-sm: 8px ; --radius: 14px ; --radius-lg: 22px ;
  --font: 'Inter', system-ui, sans-serif ;
}

══ COMPOSANTS UI MOBILES OBLIGATOIRES ══
• Cards : border-radius var(--radius), shadow 0 2px 12px rgba(0,0,0,.08), padding 16px
• Boutons primaires : background var(--c-primary), color #fff, border-radius var(--radius-lg), height 52px, font-weight 600
• Input fields : background var(--c-surface), border 1.5px solid var(--c-border), border-radius var(--radius), height 48px, padding 0 16px
• Avatar/profil : cercle 40-48px, background gradient, initiales centrées
• Liste items : padding 12px 16px, border-bottom 1px solid var(--c-border), flex gap-12px

══ ÉCRANS À GÉNÉRER (adapte au contenu demandé) ══
Minimum 4 écrans complets avec du VRAI contenu (pas lorem ipsum) :
• Accueil/Home : hero adapté + résumé du service + actions rapides
• Liste/Catalogue : liste de cards ou grille selon le type d'app
• Détail : fiche détaillée d'un item (ex: chauffeur, produit, article)
• Profil/Auth : écran connexion ou profil utilisateur

══ INTERACTIONS JS ══
• switchTab(name) : navigation entre écrans
• Boutons avec feedback visuel (active state, touch ripple)
• Formulaires : preventDefault + affichage message succès
• Si l'app a une carte (VTC, livraison) : div avec fond dégradé carte + marqueur CSS

══ ANTI-HALLUCINATION ══
• ❌ JAMAIS vrai téléphone/email/adresse de personne réelle
• ✅ "+33 6 00 00 00 00", "user@example.fr", données fictives cohérentes

TYPE APP: ${siteType} | STYLE: ${style || "moderne"} | LANGUE: ${language || "fr"} | PALETTE: ${colorPalette || "bleu/violet moderne"}${inspirationCtx}`
      : `Tu es Mar-ia, créatrice de sites web premium. Tu génères du HTML/CSS/JS complet, visuellement impactant, professionnel et 100% fonctionnel.

══ ARCHITECTURE ══
• Fichier UNIQUE : <!DOCTYPE html>…</html> — CSS dans <style>, JS dans <script> avant </body>
• Google Fonts CDN obligatoire (Inter, Raleway, Montserrat, Playfair Display…)
• Meta tags SEO : title, description, og:title, og:description, viewport

══ SPA MONO-FICHIER — NAVIGATION (ZÉRO LIEN CASSÉ) ══
• Chaque "page" = <section id="xxx"> — accueil visible par défaut, autres cachés (display:none)
• Navigation : <a href="#" onclick="showPage('xxx'); return false;">
• Logo → onclick="showPage('accueil'); return false;" href="#"
• showPage(id) DANS le <script> : hide all sections, show #id, scrollTo(0,0)
• ❌ INTERDIT : href="#hero", href="#features", href="/page", href="page.html"

⚠️ ANTI-PAGE-FANTÔME (BUG CRITIQUE) :
Pour CHAQUE lien nav avec showPage('xxx'), créer une <section id="xxx">…</section> avec du VRAI contenu.
Exemple : nav a 5 liens → 5 sections complètes. Zéro section vide, zéro section manquante.
Un showPage() sans section = page blanche → INTERDIT.

══ DESIGN SYSTEM — VARIABLES CSS OBLIGATOIRES ══
Déclare TOUJOURS dans :root {} selon la palette demandée :
  --c-primary  --c-secondary  --c-accent  --c-bg  --c-bg-alt
  --c-text  --c-text-muted  --c-border
  --font-display (titres)  --font-body (corps)
  --radius (ex: 10px)  --shadow (ex: 0 4px 24px rgba(0,0,0,.10))  --transition (ex: .25s ease)
Utilise ces variables partout — jamais de valeurs hex hardcodées dans le CSS.

══ ÉCHELLE TYPOGRAPHIQUE OBLIGATOIRE ══
• H1 hero : clamp(2.4rem, 6vw, 4rem) — gras, line-height 1.15
• H2 sections : clamp(1.6rem, 3.5vw, 2.4rem) — weight 700
• H3 cards : 1.2rem — weight 600
• Body : 1rem, line-height 1.75
• Caption/label : 0.85rem, letter-spacing .05em, text-transform uppercase

══ RESPONSIVE MOBILE-FIRST (3 BREAKPOINTS) ══
• Base CSS = mobile (< 640px) : 1 colonne, padding 1.25rem
• @media (min-width: 640px) : 2 colonnes pour les grilles
• @media (min-width: 1024px) : 3+ colonnes, layout desktop complet
• Header mobile : hamburger menu JS (toggle classe .open)

══ ANIMATIONS REQUISES ══
• IntersectionObserver sur .animate-on-scroll → classe .visible (opacity 0→1, translateY 20px→0, transition .6s)
• Hover cards : transform translateY(-4px) + box-shadow renforcé
• Hover boutons CTA : background légèrement plus sombre + transform scale(1.02)
• Header : backdrop-filter: blur(12px) + background semi-transparent au scroll (JS scroll listener)

══ IMAGES — IDs UNSPLASH FIABLES ══
Format : https://images.unsplash.com/photo-{ID}?w={W}&h={H}&fit=crop&q=80
IDs validés par thème (utilise-les ou des variantes proches) :
• Business/bureau : 1497366216-a02dc6f379e6, 1600880292-7974b9c7d43e, 1552664730-d307ca884978
• Restaurant/food : 1414235077428-338989a02e84, 1504674900247-0877df9cc836, 1567620905732-2d1ec7ab7445
• VTC/transport : 1544620347-c4be4d7dc443, 1449965408869-eaa3f722e057, 1503376780353-7e6692767b70
• Beauté/spa : 1522337360788-8b13dee7a37e, 1560066984-138daab7afb4, 1487412947147-5cebf100ffc2
• Tech/startup : 1519389950473-47ba0277781c, 1573164713714-d95e436ab8d6, 1460925895917-afdab827c52f
• Médical/santé : 1576091160399-112ba8d25d1d, 1559757148-5c350d0d3c56, 1638202993928-7267aad84c31
• Immobilier : 1560518883-ce09059eeffa, 1582407947304-2b6afb2b5df3, 1564013799919-ab600027ffc6
• Hero générique premium : 1557804506-669a67965ba0, 1486406146926-c627a92ad1ab, 1497366811353-6870744d04b2
Adapte le thème à la demande. Portrait carré : w=400&h=400

══ FORMULAIRES ══
• onsubmit="e.preventDefault(); [masque form, affiche div .success-msg]"
• Validation JS : champs required, email format, message min 10 chars
• .success-msg : "✓ Message envoyé ! Nous vous répondons sous 24h." (ou équivalent)

══ DONNÉES — ANTI-HALLUCINATION ══
• ❌ JAMAIS vrai téléphone/email/adresse de personne réelle
• ✅ "contact@[nom-marque].fr", "+33 6 00 00 00 00", "12 rue de l'Exemple, 75000 Paris"
• Témoignages : Marie D., Thomas B., Sophie L., Ahmed R. — JAMAIS noms complets réels
• Stats : UNIQUEMENT si fournies par l'utilisateur. Sinon → PAS de statistiques.
• Prix : uniquement si précisés — sinon "Sur devis" ou "À partir de X€"

TYPE: ${siteType || "landing page"} | STYLE: ${style || "moderne"} | LANGUE: ${language || "fr"} | PALETTE: ${colorPalette || "bleu/violet moderne"}${inspirationCtx}`;

    const userMessage = isMobileApp
      ? `Crée un prototype d'application mobile COMPLET et RÉALISTE dans un cadre téléphone pour : ${finalPrompt}

STRUCTURE OBLIGATOIRE :
1. <head> : charset, viewport, title, Google Fonts (Inter)
2. Body fond sombre (#0f0f0f), centré verticalement et horizontalement
3. .phone-frame : cadre téléphone (390×844px max) avec notch + status bar
4. 4 à 5 écrans complets (adapte au type d'app demandé)
5. Bottom tab bar avec 4-5 onglets + icônes SVG inline + labels
6. JS : fonction switchTab(name) pour naviguer entre les écrans

ÉCRANS REQUIS (adapte selon l'app) :
• Écran Accueil : header avec avatar/logo + salutation + résumé service + actions rapides
• Écran Liste/Catalogue : liste de cards scrollable avec avatar/image + info + bouton action
• Écran Détail : fiche complète d'un élément (ex: chauffeur disponible, produit, profil)
• Écran Profil/Auth : formulaire de connexion ou profil utilisateur avec photo
• (Optionnel selon app) Écran Carte/Map : simulation visuelle d'une carte avec marqueur CSS

QUALITÉ MOBILE :
• Fond de cards : blanc ou #f8f9fa avec border-radius 14px et ombre légère
• Boutons : height 52px, border-radius 26px (pill), couleur primaire de la palette
• Inputs : height 48px, background #f1f3f5, border-radius 12px
• Icônes bottom tab : SVG inline (pas de CDN icon), taille 24px
• Textes en français (ou langue demandée), contenu réaliste et spécifique
• Données fictives cohérentes (noms, prix, distances…)

Retourne UNIQUEMENT le code HTML complet, sans explication, sans markdown, sans backticks.`
      : `Crée un site web COMPLET et PREMIUM pour : ${finalPrompt}

STRUCTURE MINIMALE OBLIGATOIRE :
1. <head> complet : charset, viewport, title SEO, description, OG tags, Google Fonts
2. :root {} avec TOUTES les variables CSS du design system
3. Header sticky : logo + nav desktop + hamburger mobile + CTA button
4. Section hero : titre H1 impactant + sous-titre + 2 boutons CTA + visuel (image ou gradient)
5. 3 à 5 sections de contenu (adapte au type de site : services, avantages, process, galerie, tarifs, équipe, témoignages…)
6. Section contact : formulaire avec validation JS
7. Footer : logo, liens, copyright, icônes réseaux sociaux SVG

QUALITÉ ATTENDUE :
• Applique le design system (variables CSS) de façon cohérente partout
• Utilise l'échelle typographique imposée
• Ajoute les animations IntersectionObserver sur les sections
• Mobile-first avec les 3 breakpoints
• Contenu réaliste, spécifique au sujet (PAS de texte générique "lorem ipsum")
• Sections avec assez de contenu pour ressembler à un vrai site (4-6 items par grille)

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
          max_tokens: 14000,
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

      let tokensUsed = inputTokens + outputTokens;
      const durationMs = Date.now() - startTime;

      // ── POST-GENERATION AUDIT + AUTO-CORRECTION ────────────────────────────
      // Same validation loop as in the chat pipeline — ensures the initial site
      // is correct before being saved. Without this, DeepSeek can deliver broken
      // code that the user sees immediately with no chance of correction.
      if (fullCode.length > 1000) {
        for (let pass = 1; pass <= 2; pass++) {
          const staticIssues = validateGeneratedCode(fullCode);
          pipelineLog(`generate:validate:pass${pass}`, { issues: staticIssues.length, detail: staticIssues });

          let llmIssues = "";
          if (claudeKey && staticIssues.length > 0) {
            sseWrite(res, "progress", { agent: "Claude", step: `Audit qualité (passe ${pass})…`, icon: "🔍" });
            const ctrl = await tryCallSync(
              "anthropic", "claude-haiku-4-5", claudeKey,
              `Tu es un expert QA développement web. Inspecte ce code HTML/CSS/JS et liste les problèmes CONCRETS.
Réponds UNIQUEMENT "OK" si tout est correct. Sinon, liste chaque problème en 1 ligne (150 mots max total).

VÉRIFIE :
— Navigation : href="#quelquechose" sur liens nav/logo/CTA → doit être onclick="showPage('id'); return false;"
— showPage() présente dans <script> si plusieurs <section>
— Balises HTML fermées : </style> </script> </body> </html>
— JS valide : accolades équilibrées, fonctions complètes
— Code complet : pas tronqué
— Images : src vide ou relatif → doit être URL Unsplash complète
— Pages fantômes : chaque showPage('id') doit avoir sa <section id="id"> avec du vrai contenu`,
              fullCode.slice(0, 12000), 500
            );
            if (ctrl && ctrl.text.trim() !== "OK") llmIssues = ctrl.text.trim();
          }

          const allIssues = [...staticIssues, ...(llmIssues ? [llmIssues] : [])];
          if (allIssues.length === 0) {
            pipelineLog(`generate:validate:pass${pass}:ok`);
            break;
          }

          if (pass === 2) {
            pipelineLog('generate:validate:max_retries', { message: 'livraison avec code actuel' });
            break;
          }

          // Auto-correction pass
          pipelineLog(`generate:validate:pass${pass}:issues`, { count: allIssues.length });
          sseWrite(res, "progress", { agent: "DeepSeek", step: `Correction automatique (${allIssues.length} problème${allIssues.length > 1 ? 's' : ''} détecté${allIssues.length > 1 ? 's' : ''})…`, icon: "🔄" });

          const fixSysPrompt = `Tu es Mar-ia, développeuse web senior. Tu dois CORRIGER un code HTML généré qui contient des problèmes.

PROBLÈMES À CORRIGER OBLIGATOIREMENT :
${allIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

RÈGLES :
• Retourne le HTML COMPLET corrigé (pas juste les parties modifiées)
• Ne supprime AUCUNE section ou fonctionnalité existante
• Navigation : onclick="showPage('id'); return false;" — jamais href="#quelquechose"
• Code 100% complet : </style> </script> </body> </html> OBLIGATOIRES
Retourne UNIQUEMENT le code HTML, sans explication, sans markdown, sans backticks.`;

          const fixRes = await tryCallSync(
            "deepseek", "deepseek-chat", deepseekKey,
            fixSysPrompt,
            `Code à corriger :\n${fullCode}`,
            14000
          );

          if (fixRes?.text && fixRes.text.length > fullCode.length * 0.6) {
            let fixedCode = fixRes.text.trim();
            // Clean potential markdown wrapping
            const htmlIdx = fixedCode.indexOf('<!DOCTYPE html>') >= 0
              ? fixedCode.indexOf('<!DOCTYPE html>')
              : fixedCode.indexOf('<html');
            if (htmlIdx > 0) fixedCode = fixedCode.slice(htmlIdx);
            const endIdx = fixedCode.lastIndexOf('</html>');
            if (endIdx > 0) fixedCode = fixedCode.slice(0, endIdx + 7);
            if (fixedCode.length > 1000) {
              fullCode = fixedCode;
              tokensUsed += fixRes.inputTokens + fixRes.outputTokens;
              pipelineLog(`generate:validate:pass${pass}:corrected`, { codeLen: fullCode.length });
            }
          }
        }
      }

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
      const reasonerSystemPrompt = `Tu es Mar-ia, experte en développement web. Analyse attentivement le code et la demande avant de répondre.

ARCHITECTURE DU SITE (SPA mono-fichier) :
• Toutes les pages = <section id="page-id"> dans un seul fichier HTML
• Navigation : onclick="showPage('page-id'); return false;" href="#" — JAMAIS href="#xxx"
• Logo → onclick="showPage('accueil'); return false;"
• href="#hero" ou href="#features" = BUG (blanchit la preview)

ÉTAPE 1 — CLASSIFIE la demande :
• Bug visuel (rien ne s'affiche, layout cassé, blanc) → cherche : href="#xxx", showPage() manquant, CSS conflictuel
• Erreur JS (console errors) → cherche : variable undefined, function manquante, JSON invalide
• Bug responsive (mobile cassé) → cherche : overflow hidden manquant, largeur fixe en px sans max-width
• Modification design → identifie les variables CSS et classes concernées
• Ajout de contenu/section → identifie l'emplacement et le style existant à respecter
• Refonte complète → évaluer l'ampleur, lister les sections à garder vs réécrire

ÉTAPE 2 — ANALYSE DU CODE (sois précis, cite le code) :
• Pour un bug : cite le(s) ligne(s) problématique(s) exacte(s) trouvée(s) dans le code
• Pour une modif CSS : cite la variable CSS ou la classe concernée
• Pour une nouvelle section : cite les classes de section similaires à réutiliser

ÉTAPE 3 — RÉSUMÉ (120 mots max, format STRICT) :
**Demande :** [reformulation précise en 1-2 phrases]
**Diagnostic :** [problèmes concrets trouvés dans le code — cite les éléments réels, pas de généralités]
**Actions prévues :**
• [action 1 précise]
• [action 2 précise]
• [...]
**Périmètre :** HTML / CSS / JS / Contenu (coche les concernés)

⚠️ Si la demande est vague ("améliore le site"), liste 3 choix d'amélioration possibles et demande lequel.`;
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

      // ── Vision path: if images are attached, use Claude vision for reasoning ──
      // Claude is the only provider that reliably supports images in the reasoner.
      // When images are present, the reasoner MUST enumerate every visible element
      // so the executor gets a precise checklist (not a vague "create pages").
      if (images && images.length > 0 && claudeKey) {
        pipelineLog('reason:vision', { images: images.length });
        sseWrite(res, "progress", { agent: "Claude", step: "Analyse de l'image…", icon: "👁️" });
        const visionSystemPrompt = reasonerSystemPrompt + `

SI UNE IMAGE EST JOINTE (priorité absolue) :
1. Décris ce que tu vois dans l'image (menu, footer, liste de liens, design, etc.)
2. Liste TOUS les éléments visibles qui doivent être créés/modifiés, UN PAR UN :
   Ex: si l'image montre un footer avec 9 liens → liste les 9 liens numérotés
3. Dans "Actions prévues", numérote CHAQUE page/section à créer :
   • 1. Créer <section id="support"> avec page Support complète
   • 2. Créer <section id="faq"> avec page FAQ complète
   • [une ligne par page, sans exception]
⚠️ L'exécuteur créera EXACTEMENT ce que tu listes ici. N'oublie aucun élément visible.`;
        try {
          reasoning = await callSyncVision(claudeKey, "claude-haiku-4-5", visionSystemPrompt, reasonerUserMsg, images, 1000);
          if (reasoning?.text) usedReasoner = { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey };
        } catch (e) {
          pipelineLog('reason:vision:error', { error: String(e).slice(0, 100) });
        }
      }

      // ── Text-only path (no images, or vision failed) ──
      if (!reasoning?.text) {
        const startIdx = FALLBACK_CHAIN.indexOf(usedReasoner.provider);
        for (let i = startIdx; i < FALLBACK_CHAIN.length; i++) {
          const p = FALLBACK_CHAIN[i];
          const k = allKeys[p];
          if (!k) continue;
          sseWrite(res, "progress", { agent: AGENT_NAMES[p], step: "Analyse & compréhension de la demande…", icon: "🧠" });
          reasoning = await tryCallSync(p, PROVIDER_MODELS[p], k, reasonerSystemPrompt, reasonerUserMsg, 800);
          if (reasoning?.text) { usedReasoner = { provider: p, model: PROVIDER_MODELS[p], key: k }; break; }
        }
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
            `Tu es un architecte web expert. Analyse le code et produis un plan d'intervention précis (200 mots max).

ÉTAPE 1 — INVENTAIRE (lis le code et liste) :
• Variables CSS définies dans :root {} (ex: --c-primary: #2563eb, --font-display: 'Raleway')
• Classes CSS pertinentes pour la tâche (ex: .card, .btn-primary, .section-title)
• Fonctions JS existantes (ex: showPage, toggleMenu, handleFormSubmit)
• Sections HTML présentes (ex: page-accueil, page-services, page-contact)
• Animations déjà en place (IntersectionObserver, transitions, keyframes)

ÉTAPE 2 — PLAN CHIRURGICAL (ne touche QUE ce qui est demandé) :
• HTML : cite l'emplacement exact d'insertion/modification (après quelle balise, dans quel conteneur)
• CSS : cite les propriétés exactes à modifier avec les nouvelles valeurs (en utilisant les variables existantes)
• JS : cite les fonctions à créer/modifier

ÉTAPE 3 — LISTE DE PRÉSERVATION :
Ce qui ne doit PAS être touché : [liste les éléments existants à conserver absolument]

RÈGLE CRITIQUE : href="#xxx" interdit — navigation = onclick="showPage('id'); return false;" href="#"`,
            `Tâche: ${summary}\n\nCode actuel (extrait):\n${codeSnippet}`,
            900
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
• Modification du site → {"action":"modify","reply":"[1-2 phrases courtes décrivant ce qui a changé]","code":"<!DOCTYPE html>..."}
• Question conversationnelle pure (aucun changement visuel) → {"action":"chat","reply":"[réponse]"}
⚠️ Tout changement visuel, ajout de contenu, correction de bug → action="modify" OBLIGATOIRE.

══ RÈGLE 1 — LIRE AVANT D'ÉCRIRE ══
Analyse le code actuel fourni ci-dessous. Identifie EXACTEMENT :
• Les variables CSS déjà définies (--c-primary, --c-bg, --font-display, etc.) → RÉUTILISE-LES sans exception
• Les classes CSS existantes (card, btn-primary, section-title, etc.) → RÉUTILISE-LES
• Les fonctions JS présentes (showPage, toggleMenu, handleForm, etc.) → CONSERVE-LES
• Les sections/pages (id="page-xxx") → NE LES SUPPRIME PAS, même si non mentionnées
• Les animations IntersectionObserver → CONSERVE-LES si présentes

══ RÈGLE 2 — MODIFICATION CHIRURGICALE ══
Change UNIQUEMENT ce que la tâche demande. Préserve intégralement :
animations, sections, formulaires, couleurs de la palette, polices, JS existant, liens de nav.
N'ajoute rien de non demandé. N'efface rien qui fonctionne.
Si la tâche est "changer la couleur du bouton", ne touche QUE au bouton.

══ RÈGLE 3 — NAVIGATION SPA : CHAQUE PAGE DOIT EXISTER ══
• Logo → <a href="#" onclick="showPage('accueil'); return false;">
• Liens nav → <a href="#" onclick="showPage('page-id'); return false;">
• CTAs internes → onclick="showPage('page-id'); return false;"
• ❌ INTERDIT : href="#hero", href="#section", href="#features" → blanchit la preview
• showPage(id) DOIT toujours exister dans le <script>

⚠️ RÈGLE CRITIQUE — PAGES FANTÔMES (BUG LE PLUS FRÉQUENT) :
Pour CHAQUE lien de nav qui appelle showPage('xxx'), il DOIT exister une <section id="xxx"> dans le HTML.
Si tu crées un lien "Services" → onclick="showPage('services')" → tu DOIS créer <section id="services">...</section> avec du vrai contenu.
Un lien sans section correspondante = page blanche quand l'utilisateur clique.
AVANT DE FINIR : vérifie mentalement que chaque showPage('id') a bien sa <section id="id"> avec du contenu.

══ RÈGLE 4 — CODE 100% COMPLET ══
Retourne le fichier HTML ENTIER. Jamais tronqué. Jamais raccourci avec des commentaires "// reste du code".
Fermetures OBLIGATOIRES : </style> </script> </body> </html>
Si le code actuel fait 15 000 caractères, ta réponse doit faire au moins autant.

══ RÈGLE 5 — QUALITÉ DU CODE MODIFIÉ ══
• Images : https://images.unsplash.com/photo-{ID}?w=800&h=600&fit=crop&q=80 (IDs réels)
• Formulaires : onsubmit="e.preventDefault(); [masque form, affiche message succès]"
• Responsive : mobile-first, breakpoints @media (min-width: 640px) et @media (min-width: 1024px)
• Nouvelles sections ajoutées : appliquer le même style que les sections existantes (même variables CSS, même typographie)

══ RÈGLE 6 — IMAGES JOINTES PAR L'UTILISATEUR ══
Si une image est jointe ET que le plan d'action liste des éléments numérotés à créer :
• Crée une <section id="..."> complète pour CHAQUE élément listé, dans l'ordre
• Ne passe à la section suivante qu'après avoir terminé la précédente
• Chaque section doit avoir du VRAI contenu (titre, texte, éléments HTML) — pas de placeholder
• Après avoir créé toutes les sections, vérifie que chaque showPage('id') a bien sa section correspondante
• Si tu manques de place (token limit) : réduis le CSS et le contenu des sections existantes pour faire tenir toutes les nouvelles

══ CODE ACTUEL (v${currentVersion[0].versionNumber}) — LIS ATTENTIVEMENT AVANT D'ÉCRIRE ══
${currentVersion[0].generatedCode || ""}
${agentPlan ? `\n══ PLAN D'ACTION ══\n${agentPlan}` : ""}${qwenDraft ? `\n\n══ SNIPPETS PRÉPARÉS ══\n${qwenDraft}` : ""}${consoleErrors && consoleErrors.length > 0 ? `\n\n══ ERREURS JS ACTIVES DANS LA PREVIEW (console navigateur) ══\n${consoleErrors.slice(0, 8).map((e, i) => `${i + 1}. ${e}`).join('\n')}\n⚠️ Corrige TOUTES ces erreurs JS en plus de la tâche principale.` : ""}`;

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
                `Tu es un expert QA développement web. Inspecte ce code HTML/CSS/JS et liste les problèmes CONCRETS.
Réponds UNIQUEMENT "OK" si tout est correct. Sinon, liste chaque problème en 1 ligne (100 mots max total).

VÉRIFIE :
— Navigation : href="#quelquechose" sur liens nav/logo/CTA → doit être onclick="showPage('id'); return false;"
— showPage() présente dans <script> si le site a plusieurs <section>
— Balises HTML fermées : </style> </script> </body> </html>
— JS valide : accolades équilibrées, fonctions complètes, pas de syntaxe cassée
— Code complet : pas tronqué en milieu de section ou de balise
— Images : src="" vide ou src="image.png" sans URL complète → doit être URL Unsplash complète
— Formulaires : pas d'action="submit.php" → doit avoir onsubmit avec e.preventDefault()
— Pas de console.log() ou alert() de debug laissés dans le code
— Variables CSS utilisées de façon cohérente (pas de valeurs hex hardcodées contredisant :root)`,
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
            `Tu es Mar-ia. Propose 3 améliorations concrètes et variées pour continuer à enrichir ce site.
Format JSON STRICT (un seul tableau, rien d'autre) :
[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."}]

Règles :
• 7-12 mots par suggestion — actionnable, précise, spécifique au projet
• Couvre 3 axes DIFFÉRENTS parmi : contenu, design, fonctionnalité, SEO, conversion, mobile, animation
• Commence par un verbe d'action : "Ajouter...", "Améliorer...", "Créer...", "Optimiser...", "Intégrer..."
• Pas de guillemets doubles dans les textes (utilise des apostrophes si besoin)
• Pas de suggestion déjà faite dans la modification en cours`,
            `Projet: ${project[0].name} (${project[0].siteType || "site web"})\nDernière modification: ${assistantReply.slice(0, 300)}\nType de site: ${project[0].siteType || "landing page"}`,
            350
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
  // Accepts an optional base64 screenshot from the client.
  // If present: vision LLM analyses it first → visual findings fed to executor.
  // If absent:  falls back to static code analysis only.
  app.post("/api/stream/debug", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { projectId, screenshot, screenshotMimeType = "image/jpeg" } = req.body as {
      projectId: number;
      screenshot?: string;       // base64, no data: prefix
      screenshotMimeType?: string;
    };
    if (!projectId) { res.status(400).json({ error: "projectId requis" }); return; }

    const db = await getDb();
    if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }

    const project = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!project[0]) { res.status(404).json({ error: "Projet introuvable" }); return; }

    const currentVersion = await db.select().from(versions)
      .where(eq(versions.id, project[0].currentVersionId!)).limit(1);
    if (!currentVersion[0]?.generatedCode) { res.status(400).json({ error: "Aucune version à débugger" }); return; }

    // Keys: prefer Claude for vision (it handles images), fall back to OpenAI, then Deepseek for text-only
    const [claudeKey, openaiKey, deepseekKey] = await Promise.all([
      getPlatformKey("anthropic"),
      getPlatformKey("openai"),
      getPlatformKey("deepseek"),
    ]);

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const nextVersionNumber = (versionCount[0]?.count || 0) + 1;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    pipelineLog('debug:start', { project: project[0].name, hasScreenshot: !!screenshot, screenshotLen: screenshot?.length || 0 });

    const startTime = Date.now();
    let totalTokens = 0;

    try {
      // ── STEP 1 : Vision analysis (only if screenshot provided) ─────────────
      let visualFindings = "";

      if (screenshot && (claudeKey || openaiKey)) {
        const visionProvider = claudeKey ? "anthropic" : "openai";
        const visionKey = (claudeKey || openaiKey)!;
        const visionModel = claudeKey ? "claude-haiku-4-5" : "gpt-4o-mini";

        sseWrite(res, "progress", { agent: claudeKey ? "Claude Vision" : "GPT-4o Vision", step: "Analyse visuelle de la preview…", icon: "📸" });

        try {
          let visionText = "";
          if (visionProvider === "anthropic") {
            const r = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": visionKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({
                model: visionModel,
                max_tokens: 800,
                messages: [{
                  role: "user",
                  content: [
                    { type: "image", source: { type: "base64", media_type: screenshotMimeType, data: screenshot } },
                    { type: "text", text: `Tu es un expert QA web. Analyse cette capture d'écran du site "${project[0].name}" et liste UNIQUEMENT les problèmes visuels concrets que tu vois :
- Éléments cassés, mal alignés ou qui débordent
- Texte illisible, superposé ou tronqué
- Images manquantes (case blanche ou grise)
- Navigation non visible ou hors écran
- Sections vides ou avec du Lorem ipsum
- Boutons sans hover/style défini
- Problèmes de responsive visible
- Tout ce qui semble non-intentionnel ou cassé

Réponds avec une liste numérotée précise, max 8 points.
Si la page paraît correcte visuellement, réponds "VISUELLEMENT OK".` }
                  ]
                }]
              })
            });
            if (r.ok) {
              const d = await r.json() as any;
              visionText = d.content?.[0]?.text || "";
              totalTokens += (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0);
            }
          } else {
            // GPT-4o vision
            const r = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${visionKey}`, "content-type": "application/json" },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 800,
                messages: [{
                  role: "user",
                  content: [
                    { type: "image_url", image_url: { url: `data:${screenshotMimeType};base64,${screenshot}`, detail: "high" } },
                    { type: "text", text: `Analyse cette capture d'écran du site "${project[0].name}". Liste les problèmes visuels visibles (max 8). Si visuellement correct: "VISUELLEMENT OK".` }
                  ]
                }]
              })
            });
            if (r.ok) {
              const d = await r.json() as any;
              visionText = d.choices?.[0]?.message?.content || "";
              totalTokens += (d.usage?.prompt_tokens || 0) + (d.usage?.completion_tokens || 0);
            }
          }

          if (visionText && !visionText.includes("VISUELLEMENT OK")) {
            visualFindings = visionText;
            pipelineLog('debug:vision', { hasIssues: true, findingsLen: visualFindings.length });
          } else {
            pipelineLog('debug:vision', { hasIssues: false });
          }
        } catch (visionErr: any) {
          pipelineLog('debug:vision_failed', { error: String(visionErr.message) });
          // Non-fatal — continue without visual findings
        }
      }

      // ── STEP 2 : Code analysis + auto-fix ─────────────────────────────────
      // Choose best available LLM for code generation (prefer DeepSeek > Claude > OpenAI)
      // Note: Claude is reserved for vision only; DeepSeek is the workhorse for code generation
      let execKey = deepseekKey || claudeKey || openaiKey;
      let execProvider: string = deepseekKey ? "deepseek" : claudeKey ? "anthropic" : "openai";
      let execModel = deepseekKey ? "deepseek-chat" : claudeKey ? "claude-haiku-4-5" : "gpt-4o-mini";

      if (!execKey) {
        // Try user's personal stored key as last resort
        const keyRow = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id)).limit(1);
        if (keyRow[0]) {
          try { execKey = decrypt(keyRow[0].encryptedKey); execProvider = keyRow[0].provider || "anthropic"; execModel = keyRow[0].model || "claude-haiku-4-5"; }
          catch { /* ignore */ }
        }
      }
      if (!execKey) { sseWrite(res, "error", { message: "Aucune clé API disponible pour le débogage" }); res.end(); return; }

      const agentName = execProvider === "anthropic" ? "Claude" : execProvider === "deepseek" ? "DeepSeek" : "GPT-4o";
      sseWrite(res, "progress", { agent: agentName, step: visualFindings ? "Correction visuelle + code…" : "Analyse et correction du code…", icon: "🔧" });

      const visualSection = visualFindings
        ? `\n\n══ PROBLÈMES VISUELS DÉTECTÉS (capture d'écran) ══\n${visualFindings}\n⚠️ Corrige ces problèmes visuels EN PRIORITÉ.`
        : "";

      const systemPrompt = `Tu es un expert en qualité web et débogage. Analyse le code HTML/CSS/JS fourni et corrige TOUS les problèmes détectés.

CORRECTIONS OBLIGATOIRES:
1. NAVIGATION CASSÉE: href="page.html", href="/page" → sections <section id="page-xxx"> + onclick="showPage('id'); return false;"
2. IMAGES CASSÉES: src="", src="#", chemins locaux → https://images.unsplash.com/photo-ID?w=800&q=80 (images thématiques)
3. ERREURS JS: variables/fonctions inexistantes, event listeners orphelins, console.error visibles
4. BOUTONS SANS ACTION: chaque bouton/CTA doit avoir un onclick défini
5. FORMULAIRES: chaque <form> doit avoir un onsubmit JS affichant un message de confirmation
6. CONTENU: remplace Lorem ipsum par du vrai contenu cohérent avec le site
7. RESPONSIVE: assure que le site s'affiche correctement sur mobile (meta viewport, media queries)
8. SHOWPAGE: si le site a plusieurs <section id="page-...">, la fonction showPage() DOIT exister
${visualSection}

Retourne UNIQUEMENT ce JSON brut (pas de markdown, pas de \`\`\`):
{"fixed_code":"<!DOCTYPE html>...code HTML complet corrigé...","report":"• Problème 1 corrigé\\n• Problème 2 corrigé"}`;

      const userMessage = `Site: "${project[0].name}"\nAnalyse et corrige ce code complet:\n\n${currentVersion[0].generatedCode}`;

      let fullRaw = "";
      let inputTokens = 0;
      let outputTokens = 0;

      if (execProvider === "anthropic") {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": execKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: execModel, max_tokens: 16000, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur Claude: ${await aiRes.text()}` }); res.end(); return; }
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
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") fullRaw += evt.delta.text;
              if (evt.type === "message_delta" && evt.usage) outputTokens = evt.usage.output_tokens || 0;
              if (evt.type === "message_start" && evt.message?.usage) inputTokens = evt.message.usage.input_tokens || 0;
            } catch { /* skip */ }
          }
        }
      } else {
        const baseUrls: Record<string, string> = { deepseek: "https://api.deepseek.com/v1", openai: "https://api.openai.com/v1" };
        const aiRes = await fetch(`${baseUrls[execProvider] || "https://api.openai.com/v1"}/chat/completions`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${execKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: execModel, max_tokens: 16000, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }] }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: `Erreur ${execProvider}: ${await aiRes.text()}` }); res.end(); return; }
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
              if (chunk) fullRaw += chunk;
              if (evt.usage) { inputTokens = evt.usage.prompt_tokens || 0; outputTokens = evt.usage.completion_tokens || 0; }
            } catch { /* skip */ }
          }
        }
      }

      totalTokens += inputTokens + outputTokens;
      const durationMs = Date.now() - startTime;

      // Parse result
      let fixedCode = "";
      let report = "Analyse terminée.";
      try {
        const extracted = extractJsonObject(fullRaw) ?? fullRaw;
        const parsed = JSON.parse(extracted);
        fixedCode = parsed.fixed_code || parsed.code || "";
        report = parsed.report || "Code corrigé.";
      } catch {
        const htmlIdx = fullRaw.search(/<!DOCTYPE html>/i);
        if (htmlIdx >= 0) {
          const tail = fullRaw.slice(htmlIdx);
          const end = tail.lastIndexOf("</html>");
          fixedCode = end >= 0 ? tail.slice(0, end + 7) : tail;
          report = visualFindings ? `Corrections visuelles + code appliquées.` : "Code corrigé.";
        } else {
          sseWrite(res, "error", { message: "Le modèle n'a pas retourné de code valide" });
          res.end(); return;
        }
      }

      if (!fixedCode) { sseWrite(res, "error", { message: "Aucun code corrigé reçu" }); res.end(); return; }

      // Run static validation on fixed code (quick sanity check)
      const remainingIssues = validateGeneratedCode(fixedCode);
      const fullReport = [
        ...(visualFindings ? [`📸 Analyse visuelle :\n${visualFindings}`] : []),
        report,
        ...(remainingIssues.length > 0 ? [`⚠️ Problèmes résiduels : ${remainingIssues.join(", ")}`] : []),
      ].join("\n\n");

      pipelineLog('debug:done', { tokensUsed: totalTokens, durationMs, hasVisual: !!visualFindings, residualIssues: remainingIssues.length });

      // Save new version
      const [versionResult] = await db.insert(versions).values({
        projectId,
        userId: user.id,
        versionNumber: nextVersionNumber,
        label: `Debug v${nextVersionNumber}${visualFindings ? " (vision)" : ""}`,
        prompt: "Débogage automatique",
        generatedCode: fixedCode,
        tokensUsed: totalTokens,
        generationTimeMs: durationMs,
        model: execModel,
        status: "ready",
      }).returning({ id: versions.id });

      await db.update(projects).set({ currentVersionId: versionResult.id, status: "ready" }).where(eq(projects.id, projectId));

      await db.insert(usageLogs).values({
        userId: user.id, projectId, action: "debug", model: execModel,
        tokensUsed: totalTokens, durationMs,
        costEstimateUsd: Math.round(estimateCost(execModel, inputTokens, outputTokens) * 1_000_000),
        status: "success",
      }).catch(() => {});

      sseWrite(res, "done", { versionId: versionResult.id, report: fullReport, tokensUsed: totalTokens });
    } catch (err: any) {
      pipelineLog('debug:error', { error: String(err.message) });
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
