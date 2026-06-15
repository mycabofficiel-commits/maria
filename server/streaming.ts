/**
 * Streaming routes for Maria AI — uses Anthropic SSE with prompt caching.
 * Mounted at /api/stream/* in server/_core/index.ts
 */
import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { projects, versions, chatMessages, apiKeys, users, usageLogs, platformApiKeys, userIntegrations } from "../drizzle/schema";
import { getIntegrationKey } from "./routers/integrations";
import { eq, and, desc, count, sum, gte } from "drizzle-orm";
import crypto from "crypto";
import { buildInspirationContext } from "./inspiration";
import { PLAN_LIMITS, type PlanName } from "@shared/const";

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

  // 2. Broken anchor links — href="#id" pointant vers une section inexistante.
  //    Une ancre one-page valide (href="#services" + <section id="services">) N'EST PAS un bug.
  const anchorLinks = Array.from(new Set(
    (html.match(/href="#([a-zA-Z][^"]{0,40})"/g) || [])
      .map(m => { const r = m.match(/href="#([^"]+)"/); return r ? r[1] : null; })
      .filter(Boolean) as string[]
  ));
  const brokenAnchors = anchorLinks.filter(id => {
    if (id === 'top' || id === 'accueil') return false;
    return !(new RegExp(`id=["']${id.replace(/[^a-zA-Z0-9_-]/g, '')}["']`, 'i')).test(html);
  });
  if (brokenAnchors.length > 0) {
    issues.push(
      `Ancres cassées : ${brokenAnchors.slice(0, 4).map(id => `#${id}`).join(' ')} pointent vers une section inexistante. ` +
      `Crée la <section id="..."> correspondante, ou corrige le lien.`
    );
  }

  // 3. showPage() appelée mais non définie (SPA multi-pages sans son routeur).
  //    Un site one-page (plusieurs sections, sans showPage) est VALIDE → on ne le signale pas.
  const usesShowPage = /onclick\s*=\s*["'][^"']*showPage\s*\(/i.test(html);
  if (usesShowPage && !html.match(/function\s+showPage\s*\(/)) {
    issues.push('La navigation appelle showPage() mais la fonction est absente du <script>');
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

/** True if the HTML document looks cut off (no closing </html>). */
function isHtmlTruncated(code: string): boolean {
  return !!code && code.length > 200 && !/<\/html>/i.test(code);
}

/**
 * Concatenates a continuation onto a base, removing any overlap where the model
 * repeated the end of the base at the start of the continuation.
 */
function stitchHtml(base: string, cont: string): string {
  const max = Math.min(base.length, cont.length, 600);
  for (let k = max; k > 12; k--) {
    if (base.endsWith(cont.slice(0, k))) return base + cont.slice(k);
  }
  return base + cont;
}

/** Last-resort: append any missing closing tags so the document at least parses. */
function ensureHtmlClosed(code: string): string {
  let c = code;
  const open  = (re: RegExp) => (c.match(re) || []).length;
  if (open(/<style[^>]*>/gi) > open(/<\/style>/gi))            c += "\n</style>";
  if (open(/<script(?![^>]*\ssrc)[^>]*>/gi) > open(/<\/script>/gi)) c += "\n</script>";
  if (!/<\/body>/i.test(c)) c += "\n</body>";
  if (!/<\/html>/i.test(c)) c += "\n</html>";
  return c;
}

// ── Post-traitement des sites générés (s'applique à TOUS les projets) ─────────

/**
 * Force l'année EN COURS dans les copyrights ("© 2025" → "© <année>").
 * Les LLM ont une date d'entraînement figée et écrivent souvent une vieille année.
 */
function applyCurrentYear(html: string): string {
  if (!html) return html;
  const year = String(new Date().getFullYear());
  return html.replace(/(©|&copy;|Copyright\s*©?)\s*(\d{4})/gi, (_m, sym) => `${sym} ${year}`);
}

// Détecte le crédit déjà présent : soit notre classe marqueur, soit la phrase
// « Créé avec … Mar-ia.net » même avec une balise <a> entre les deux.
const MARIA_CREDIT_RE = /maria-credit|cr[ée]{1,2}\s+avec[\s\S]{0,60}mar-?ia\.net/i;

/**
 * Garantit le crédit « Créé avec Mar-ia.net » dans le footer du site.
 * - `canOmit=false` (génération, comptes gratuits) → réinjecté s'il manque.
 * - `canOmit=true`  (comptes payants en édition chat) → laissé tel quel,
 *   ils peuvent donc le retirer via le chat.
 */
function enforceMariaCredit(html: string, canOmit: boolean): string {
  if (!html || html.length < 50) return html;
  if (MARIA_CREDIT_RE.test(html)) return html; // déjà présent
  if (canOmit) return html;                     // payant : libre de l'enlever
  const badge = `<div class="maria-credit" style="text-align:center;padding:12px;font-size:12px;line-height:1.4;opacity:.7">Créé avec <a href="https://mar-ia.net" target="_blank" rel="noopener" style="color:inherit;font-weight:600;text-decoration:none">Mar-ia.net</a></div>`;
  if (/<\/footer>/i.test(html)) return html.replace(/<\/footer>/i, `${badge}</footer>`);
  if (/<\/body>/i.test(html))   return html.replace(/<\/body>/i, `${badge}</body>`);
  return html; // pas un document HTML (ex: Expo/React Native) → on n'ajoute rien
}

/**
 * Post-traitement complet d'un site HTML avant sauvegarde.
 * `canOmitCredit` = compte payant en édition (peut retirer le crédit).
 */
function postProcessSite(html: string, canOmitCredit: boolean): string {
  return enforceMariaCredit(applyCurrentYear(html), canOmitCredit);
}

/**
 * Repairs TRUNCATED HTML by asking the LLM to CONTINUE from where it stopped.
 * Regenerating the whole file re-hits the same max_tokens ceiling and truncates
 * again; continuation only produces the missing tail, so it actually finishes.
 * Falls back to appending closing tags if continuation makes no progress.
 */
async function completeTruncatedHtml(
  code: string,
  allKeys: Partial<Record<Provider, string | null>>,
  startFrom: Provider,
  res: Response,
  maxAttempts = 3,
): Promise<string> {
  let full = code;
  for (let i = 0; i < maxAttempts && isHtmlTruncated(full); i++) {
    const tail = full.slice(-1800);
    const sys = `Tu COMPLÈTES un fichier HTML coupé en pleine génération (limite de tokens atteinte).
RÈGLES STRICTES :
• Reprends EXACTEMENT après le dernier caractère fourni — ne répète RIEN de ce qui précède.
• Ne réécris pas le début, n'ajoute aucune explication, aucun markdown, aucun backtick.
• Produis uniquement la SUITE du code jusqu'à fermer proprement : termine la déclaration CSS/JS en cours, puis </style> (si ouvert), le HTML manquant, </script>, </body>, </html>.
• Garde le même style, les mêmes variables CSS et classes que l'extrait.`;
    const userMsg = `FIN DU CODE DÉJÀ GÉNÉRÉ (continue juste après, sans la répéter) :\n\n${tail}`;
    const cont = await tryCallWithFallback(
      allKeys, sys, userMsg, 16000, res, "Complétion du code tronqué…", "🧩", startFrom,
    );
    let piece = (cont?.text || "").trim();
    if (!piece) break;
    piece = piece.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();
    const before = full.length;
    full = stitchHtml(full, piece);
    if (full.length - before < 15) break; // no real progress → stop
  }
  return isHtmlTruncated(full) ? ensureHtmlClosed(full) : full;
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

/** Parse a raw LLM error body into a clean user-readable message (never raw JSON) */
function parseLlmError(raw: string, provider?: string): string {
  try {
    const j = JSON.parse(raw);
    const msg: string = j?.error?.message || j?.message || raw;
    if (msg.includes("credit") || msg.includes("balance") || msg.includes("quota") || msg.includes("billing"))
      return `Crédits insuffisants${provider ? ` (${provider})` : ""}. L'IA bascule automatiquement sur un autre modèle.`;
    return msg.slice(0, 200);
  } catch { return raw.slice(0, 200); }
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

/**
 * Vision-capable sync call via OpenAI GPT-4o (fallback quand aucune clé Anthropic
 * n'est configurée). Permet de lire les images même sans Claude.
 */
async function callSyncVisionOpenAI(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  images: Array<{ base64: string; mimeType: string }>,
  maxTokens = 1000
): Promise<LlmResult> {
  const imageBlocks = images.map(img => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" as const },
  }));
  const userContent = [...imageBlocks, { type: "text" as const, text: userMessage }];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
    }),
  });
  if (!r.ok) throw new Error(`openai vision error: ${await r.text()}`);
  const d = await r.json() as any;
  return {
    text: d.choices?.[0]?.message?.content || "",
    inputTokens: d.usage?.prompt_tokens || 0,
    outputTokens: d.usage?.completion_tokens || 0,
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
 * Non-streaming LLM call with automatic fallback through the FALLBACK_CHAIN.
 * Starts from `startFrom` provider and walks forward until one succeeds.
 * Emits SSE progress events to `res` at each attempt/relay.
 */
async function tryCallWithFallback(
  allKeys: Partial<Record<Provider, string | null>>,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  res: Response,
  stepLabel: string,
  stepIcon: string,
  startFrom: Provider = "openai"
): Promise<(LlmResult & { provider: Provider; model: string; key: string }) | null> {
  const startIdx = FALLBACK_CHAIN.indexOf(startFrom);
  const chain = startIdx >= 0 ? FALLBACK_CHAIN.slice(startIdx) : [...FALLBACK_CHAIN];
  for (const provider of chain) {
    const key = allKeys[provider];
    if (!key) continue;
    sseWrite(res, "progress", { agent: AGENT_NAMES[provider], step: stepLabel, icon: stepIcon });
    const result = await tryCallSync(provider, PROVIDER_MODELS[provider], key, systemPrompt, userMessage, maxTokens);
    if (result?.text) return { ...result, provider, model: PROVIDER_MODELS[provider], key };
    // Find next available provider for relay message
    const nextProvider = chain.slice(chain.indexOf(provider) + 1).find(p => allKeys[p]);
    if (nextProvider) {
      sseWrite(res, "progress", { agent: AGENT_NAMES[provider], step: `Indisponible — relais ${AGENT_NAMES[nextProvider]}…`, icon: "⏭️" });
    }
  }
  return null;
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
    - Expo : import { LinearGradient } from 'expo-linear-gradient';
    - Carte/Map : const WebViewNative = Platform.OS !== 'web' ? require('react-native-webview').WebView : null;  ← chargement dynamique OBLIGATOIRE (pas d'import statique)
• INTERDIT ABSOLUMENT : react-native-svg, react-navigation, @react-navigation, expo-router, @expo/vector-icons, react-native-vector-icons, react-native-maps, react-native-reanimated, toute lib non listée ci-dessus

══ CARTE OPENSTREETMAP — PATTERN OBLIGATOIRE ══
Si l'app nécessite une carte (géolocalisation, VTC, livraison, trajets…) :
• JAMAIS "import { WebView } from 'react-native-webview'" en haut du fichier (crash preview web Snack)
• TOUJOURS charger WebView dynamiquement via Platform.OS — pattern OBLIGATOIRE :

  const WebViewNative = Platform.OS !== 'web' ? require('react-native-webview').WebView : null;
  const mapHtml = \`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>html,body,#map{margin:0;padding:0;width:100%;height:100%}</style>
  </head><body><div id="map"></div><script>
    var map = L.map('map').setView([LAT, LNG], ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(map);
    L.marker([LAT, LNG]).addTo(map).bindPopup('LABEL').openPopup();
  </script></body></html>\`;
  // Dans le composant :
  // if (WebViewNative) return <WebViewNative source={{ html: mapHtml }} style={{ flex:1 }} />;
  // return <View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:'#e8f4f8'}}><Text style={{fontSize:40}}>🗺️</Text><Text style={{color:'#666',marginTop:8}}>Carte sur mobile</Text></View>;

• Ce pattern : carte réelle sur téléphone (Expo Go) + placeholder carte sur preview web
• ❌ JAMAIS react-native-maps (crash Expo Snack)
• ❌ JAMAIS import statique en haut : import { WebView } from 'react-native-webview'
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

══ AUTHENTIFICATION — RÈGLE CRITIQUE ══
Si l'app inclut un système d'authentification (login, connexion, compte, profil protégé) :
• OBLIGATOIRE : 2 écrans distincts — RegisterScreen (créer un compte) ET LoginScreen (se connecter)
• RegisterScreen : champs prénom, nom, email, mot de passe, confirmation MDP + bouton "Créer mon compte" + lien "Déjà un compte ? Se connecter"
• LoginScreen : champs email + mot de passe + bouton "Se connecter" + lien "Pas encore de compte ? S'inscrire"
• Navigation croisée via useState entre Register ↔ Login
• Après inscription/connexion réussie → écran principal de l'app (HomeScreen ou TabBar)
• L'auth precède toujours le TabBar — l'utilisateur doit être "connecté" pour voir l'app
• Gérer l'état isLoggedIn / isRegistered avec useState, simuler avec données fictives

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

⚠️ SI L'APP INCLUT UNE AUTHENTIFICATION :
• Génère IMPÉRATIVEMENT RegisterScreen (créer un compte) ET LoginScreen (se connecter)
• RegisterScreen en premier — c'est la porte d'entrée naturelle d'un nouvel utilisateur
• Inclus les liens croisés : "Déjà un compte ?" sur Register → Login, "Pas de compte ?" sur Login → Register
• Le TabBar n'apparaît QU'APRÈS connexion/inscription réussie (isLoggedIn useState)

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
      sseWrite(res, "error", { message: parseLlmError(await aiRes.text(), "DeepSeek") });
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
            "expo-linear-gradient": "~15.0.8",
            "react-native-webview": "13.10.5",
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

  // ── POST /api/expo/html-preview ─────────────────────────────────────────────
  // Streaming SSE: envoie les tokens HTML au fur et à mesure (premier token ~3s)
  app.post("/api/expo/html-preview", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { code, projectName = "App" } = req.body as { code: string; projectName?: string };
    if (!code) return res.status(400).json({ error: "code requis" });

    try {
      const deepseekKey = await getPlatformKey("deepseek");
      if (!deepseekKey) return res.status(503).json({ error: "Clé LLM manquante" });

      // SSE headers — stream tokens as they arrive
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const aiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${deepseekKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          stream: true,
          max_tokens: 4000,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `Tu convertis un fichier App.js React Native en une preview HTML mobile fidèle. Retourne UNIQUEMENT du HTML brut — aucun markdown, aucune explication, aucun backtick.

═══ STRUCTURE GÉNÉRALE ═══
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  html { height:100%; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; height:100%; display:flex; flex-direction:column; overflow:hidden; }
  #app { flex:1; display:flex; flex-direction:column; min-height:0; }
  .screen { display:none; flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .screen.active { display:flex; flex-direction:column; }
  .tab-bar { flex-shrink:0; display:flex; height:60px; padding:6px 0 10px; border-top:1px solid rgba(0,0,0,.1); }
  .tab-btn { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; font-size:10px; cursor:pointer; border:none; background:transparent; padding:0; }
  /* copie TOUTES les couleurs du StyleSheet ici en variables CSS : --primary, --bg, --card, etc. */
</style>
</head>
<body>
<div id="app">
  <!-- TOUS les écrans : <div class="screen active" id="screen-NOM"> pour le PREMIER, <div class="screen" id="screen-NOM2"> pour les autres -->
  <!-- Barre d'onglets OBLIGATOIRE si l'app a des onglets : <div class="tab-bar" style="background:[couleur fond nav]"> -->
</div>
<script>
function showTab(id,btn){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.style.opacity='0.5');
  if(btn){btn.style.opacity='1';btn.style.color=getComputedStyle(document.documentElement).getPropertyValue('--primary')||'#e53e3e';}
}
window.onload=function(){var f=document.querySelector('.tab-btn');if(f){f.style.opacity='1';}};
</script>
</body></html>

═══ RÈGLES DE CONVERSION ═══
React Native → HTML :
- View → <div>
- Text (titre h1/h2) → <h1>/<h2> ; Text normal → <p> ou <span>
- TouchableOpacity / Pressable → <button> avec cursor:pointer, border:none, background:transparent
- ScrollView → <div style="overflow-y:auto">
- FlatList → <div> avec les items dedans (génère 3-5 items représentatifs si données dynamiques)
- Image → <div style="background:#ccc;border-radius:...;overflow:hidden"> ou <img> si src disponible
- TextInput → <input type="text">
- LinearGradient → <div style="background:linear-gradient(...)"> (copie direction et couleurs)
- SafeAreaView → <div style="padding-top:44px">
- StatusBar → <div style="height:44px;background:[couleur]">
- Icônes (Ionicons, MaterialIcons, FontAwesome) → emoji équivalent ou SVG inline simple

═══ NAVIGATION & ONGLETS ═══
Si l'app a des onglets (TabBar, BottomTabNavigator, ou navigation bas) :
- STRUCTURE OBLIGATOIRE à placer dans <div id="app"> :
  1. <div class="screen active" id="screen-NOM1"> ... contenu écran 1 ... </div>
  2. <div class="screen" id="screen-NOM2"> ... contenu écran 2 ... </div>
  3. (autant d'écrans que d'onglets)
  4. <div class="tab-bar" style="background:[couleur du fond de nav bar]">
       <button class="tab-btn" onclick="showTab('screen-NOM1',this)" style="opacity:1;color:[couleur primaire]">🏠<span>Accueil</span></button>
       <button class="tab-btn" onclick="showTab('screen-NOM2',this)" style="opacity:0.5">📋<span>Courses</span></button>
       ...
     </div>
- La classe .screen gère déjà overflow-y:auto — NE PAS ajouter de style display/height inline sur les screens
- La classe .tab-bar est déjà flex avec height:60px — NE PAS utiliser position:fixed
- showTab() est déjà défini dans le <script> — NE PAS le redéfinir

═══ FIDÉLITÉ VISUELLE ═══
- Copie EXACTEMENT les couleurs du StyleSheet (primaryColor, backgroundColor, etc.)
- Respecte les border-radius, padding, margin, fontSize définis dans les styles
- Si l'app a un fond sombre → body background sombre
- Barre d'onglets : même fond, même couleur active/inactive que dans le StyleSheet
- Génère du VRAI contenu représentatif (pas de Lorem ipsum) — si l'app montre des données (trajets VTC, services, prix), invente 3-4 exemples réalistes
- Card/item : reproduit avec les bonnes ombres (box-shadow), arrondis et espacements
- Ajoute padding-bottom au dernier écran pour que la barre d'onglets ne cache pas le contenu

═══ INTERDITS ═══
- Aucune bibliothèque CDN externe
- Aucun import ES module
- Aucun placeholder vide (divs sans contenu)
- Aucune troncature du HTML — le rendu doit être complet jusqu'à </html>`
            },
            {
              role: "user",
              content: `App.js (${projectName}):\n\n${code.slice(0, 7000)}`
            }
          ],
        }),
        signal: AbortSignal.timeout(90000),
      });

      if (!aiRes.ok || !aiRes.body) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: "Erreur LLM" })}\n\n`);
        res.end(); return;
      }

      const reader = aiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullHtml = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw);
            const chunk = evt.choices?.[0]?.delta?.content;
            if (chunk) {
              fullHtml += chunk;
              res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
            }
          } catch { /* skip malformed */ }
        }
      }

      // Nettoyage markdown résiduel
      fullHtml = fullHtml.replace(/^```html\n?/i, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
      res.write(`event: done\ndata: ${JSON.stringify({ html: fullHtml })}\n\n`);
      res.end();
    } catch (err: any) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      } catch { /* already ended */ }
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

    // ── Check daily generations limit (based on usageLogs for today) ────────
    const userRow = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const u = userRow[0];
    const userPlan = (u?.plan || "free") as PlanName;
    const planLimits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
    const planMaxTokens = planLimits.maxTokensPerGen;

    if (planLimits.dailyGenerations > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayCount = await db.select({ count: count() }).from(usageLogs)
        .where(and(
          eq(usageLogs.userId, user.id),
          gte(usageLogs.createdAt, todayStart),
        ));
      const used = Number(todayCount[0]?.count || 0);
      if (used >= planLimits.dailyGenerations) {
        res.status(403).json({
          error: `Limite de ${planLimits.dailyGenerations} génération(s)/jour atteinte. Revenez demain ou passez à un plan supérieur.`,
        });
        return;
      }
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
    // Le nom du projet EST le nom de la marque/du site — jamais inventé.
    const brandSlug = projectName.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "marque";
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
• Profil/Auth : si auth demandée → DEUX écrans obligatoires : RegisterScreen ("Créer un compte" : prénom, email, MDP, bouton inscription) ET LoginScreen ("Se connecter" : email, MDP, bouton connexion) + lien croisé entre les deux

══ INTERACTIONS JS ══
• switchTab(name) : navigation entre écrans
• Boutons avec feedback visuel (active state, touch ripple)
• Formulaires : preventDefault + affichage message succès
• Si l'app a une carte (VTC, livraison) : div avec fond dégradé carte + marqueur CSS

══ ANTI-HALLUCINATION ══
• ❌ JAMAIS vrai téléphone/email/adresse de personne réelle
• ✅ "+33 6 00 00 00 00", "user@example.fr", données fictives cohérentes

TYPE APP: ${siteType} | STYLE: ${style || "moderne"} | LANGUE: ${language || "fr"} | PALETTE: ${colorPalette || "bleu/violet moderne"}${inspirationCtx}`
      : `Tu es Mar-ia, créatrice de sites web premium. Tu génères du HTML/CSS/JS complet, visuellement SPECTACULAIRE, moderne, professionnel et 100% fonctionnel. Qualité Dribbble / Awwwards.

══ ARCHITECTURE ══
• Fichier UNIQUE : <!DOCTYPE html>…</html> — CSS dans <style>, JS dans <script> avant </body>
• Google Fonts CDN obligatoire — COMBINE 2 polices : une display (Playfair Display, Raleway, Poppins, Montserrat, DM Serif Display) + une body (Inter, Nunito, DM Sans)
• Meta tags SEO : title, description, og:title, og:description, viewport

══ NAVIGATION ONE-PAGE (DÉFAUT POUR UN SITE VITRINE — ZÉRO LIEN CASSÉ) ══
Un site vitrine est par défaut une SEULE page qui défile (one-page), avec un menu qui scrolle vers les sections.
• Chaque bloc = <section id="xxx"> — TOUTES visibles, empilées (PAS de display:none, PAS de showPage)
• Menu = vraies ancres : <a href="#services">Services</a>, <a href="#tarifs">Tarifs</a>…
• Logo → <a href="#accueil"> (avec <section id="accueil"> ou <header id="accueil"> en haut)
• CSS obligatoire : html{scroll-behavior:smooth} et scroll-margin-top:80px sur les sections (header fixe)
• ❌ INTERDIT : liens vers fichiers externes inexistants (href="/page", href="page.html")

⚠️ ANTI-LIEN-CASSÉ (BUG CRITIQUE) :
Pour CHAQUE lien de menu href="#xxx", il DOIT exister une <section id="xxx">…</section> avec du VRAI contenu.
Exemple : menu de 5 liens → 5 sections complètes. Zéro section vide, zéro ancre vers une section manquante.

(Option avancée — UNIQUEMENT si l'utilisateur veut de vraies pages distinctes qui se remplacent, type web-app :
utilise alors onclick="showPage('xxx'); return false;" + une fonction showPage(id) dans le <script>, et chaque
showPage('id') doit avoir sa <section id="id">. Sinon, reste en one-page.)

══ DESIGN SYSTEM — VARIABLES CSS OBLIGATOIRES ══
Déclare TOUJOURS dans :root {} selon la palette demandée :
  --c-primary  --c-secondary  --c-accent  --c-bg  --c-bg-alt
  --c-text  --c-text-muted  --c-border
  --font-display (titres)  --font-body (corps)
  --radius (ex: 12px)  --radius-lg (ex: 24px)
  --shadow (ex: 0 8px 32px rgba(0,0,0,.12))  --shadow-lg (ex: 0 24px 64px rgba(0,0,0,.18))
  --transition (ex: .3s cubic-bezier(.4,0,.2,1))
Utilise ces variables partout — jamais de valeurs hex hardcodées dans le CSS.

══ HÉRO — OBLIGATOIRE (pleine page, fort impact) ══
Le héro doit occuper min-height:100vh. Options selon le style :
• Image de fond Unsplash avec overlay gradient semi-transparent + texte blanc
• Gradient diagonal bold (ex: linear-gradient(135deg, var(--c-primary) 0%, var(--c-secondary) 100%))
• Split-screen : image à droite, texte + CTA à gauche
Toujours : titre H1 + sous-titre percutant + 2 boutons CTA différenciés (primary filled + outline).

══ SECTIONS DE CONTENU — RICHESSE OBLIGATOIRE ══
Chaque section doit avoir du "wow factor". Standards minimaux :
• Services/features : grille 3+ cards avec icône SVG inline + titre + description (100+ mots de contenu par card)
• Témoignages : carousel ou grille avec avatar CSS (initiales colorées), étoiles ★, texte + nom + poste
• Stats/chiffres : compteurs animés (IntersectionObserver), fond en dégradé, 4 métriques
• Process : timeline verticale ou numérotée, étapes détaillées
• Galerie/Portfolio : grille masonry CSS 3 colonnes, images Unsplash, hover overlay avec infos
• Pricing : 3 cards, card centrale highlighted (border 2px primary, scale 1.05), features list avec ✓/✗

══ ÉCHELLE TYPOGRAPHIQUE OBLIGATOIRE ══
• H1 hero : clamp(2.8rem, 7vw, 5rem) — font-weight 800, line-height 1.1, letter-spacing -0.02em
• H2 sections : clamp(1.8rem, 4vw, 2.8rem) — font-weight 700, position relative avec pseudo-élément décoratif
• H3 cards : 1.25rem — font-weight 600
• Body : 1rem, line-height 1.8, color: var(--c-text-muted)
• Labels/badges : 0.75rem, letter-spacing 0.1em, text-transform uppercase, font-weight 600

══ RESPONSIVE MOBILE-FIRST (3 BREAKPOINTS) ══
• Base CSS = mobile (< 640px) : 1 colonne, padding 1.25rem
• @media (min-width: 640px) : 2 colonnes pour les grilles
• @media (min-width: 1024px) : 3+ colonnes, layout desktop complet
• Header mobile : hamburger menu JS (toggle classe .open)

══ ANIMATIONS PREMIUM ══
• IntersectionObserver sur .animate-on-scroll → classe .visible (opacity 0→1, translateY 30px→0, transition .7s ease)
• Stagger : nth-child(n) { transition-delay: calc(n * 0.1s) } sur les grilles de cards
• Hover cards : transform translateY(-8px) + box-shadow var(--shadow-lg) + transition var(--transition)
• Hover boutons CTA : scale(1.04) + ombre renforcée
• Header : backdrop-filter:blur(16px) + background:rgba(255,255,255,.85) au scroll (JS scroll listener)
• Compteurs animés : IntersectionObserver → setInterval pour incrémenter de 0 à la valeur cible

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

⚠️ NOM DE L'APPLICATION : « ${projectName} »
C'est le nom EXACT et IMPOSÉ de l'app. Utilise-le partout : <title>, logo/titre dans le header de l'app, écran d'accueil, splash, footer. N'INVENTE JAMAIS un autre nom d'app ou de marque. Si la description suggère un autre nom, celui du projet « ${projectName} » prime toujours.

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
• Écrans Auth (si auth demandée) : DEUX écrans obligatoires — RegisterScreen ("Créer un compte" : prénom, email, MDP, bouton "S'inscrire", lien "Déjà un compte ?") ET LoginScreen ("Se connecter" : email, MDP, bouton "Connexion", lien "Pas encore de compte ?") avec navigation croisée
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

⚠️ NOM DU SITE / DE LA MARQUE : « ${projectName} »
C'est le nom EXACT et IMPOSÉ. Utilise-le partout : <title>, balise du logo dans le header, footer, copyright, email de contact (contact@${brandSlug}.fr). N'INVENTE JAMAIS un autre nom de marque, d'entreprise ou de site. Si la description suggère un autre nom, celui du projet « ${projectName} » prime toujours.

STRUCTURE MINIMALE OBLIGATOIRE :
1. <head> complet : charset, viewport, title SEO, description, OG tags, Google Fonts
2. :root {} avec TOUTES les variables CSS du design system
3. Header sticky : logo + nav desktop + hamburger mobile + CTA button
4. Section hero : titre H1 impactant + sous-titre + 2 boutons CTA + visuel (image ou gradient)
5. 3 à 5 sections de contenu (adapte au type de site : services, avantages, process, galerie, tarifs, équipe, témoignages…)
6. Section contact : formulaire avec validation JS
7. Footer : logo, liens, copyright « © ${new Date().getFullYear()} ${projectName}. Tous droits réservés. », icônes réseaux sociaux (SVG inline) + crédit « Créé avec Mar-ia.net »

QUALITÉ ATTENDUE :
• Applique le design system (variables CSS) de façon cohérente partout
• Utilise l'échelle typographique imposée
• Ajoute les animations IntersectionObserver sur les sections
• Mobile-first avec les 3 breakpoints
• Contenu réaliste, spécifique au sujet (PAS de texte générique "lorem ipsum")
• Sections avec assez de contenu pour ressembler à un vrai site (4-6 items par grille)

══ RÈGLES IMPÉRATIVES — FOOTER, LANGUES, RÉSEAUX SOCIAUX ══
• COPYRIGHT : utilise TOUJOURS l'année en cours = ${new Date().getFullYear()}. JAMAIS une année passée.
• CRÉDIT OBLIGATOIRE : ajoute TOUJOURS tout en bas du footer le crédit « Créé avec <a href="https://mar-ia.net" target="_blank" rel="noopener">Mar-ia.net</a> ». Ne l'omets sous aucun prétexte.
• RÉSEAUX SOCIAUX : chaque icône = un <svg viewBox="0 0 24 24"> INLINE avec le vrai <path> de la marque (Instagram, Facebook, X, LinkedIn, TikTok, YouTube…), 20-24px, fill="currentColor". INTERDIT : <i class="fa-…"> (pas de CDN chargé), emojis en guise de logo, ou <img src> externe susceptible de renvoyer 404. Les logos DOIVENT s'afficher sans dépendance externe.
• LANGUES : LANGUE demandée = « ${language || "fr"} ». Si PLUSIEURS langues sont listées, ajoute un sélecteur de langue RÉELLEMENT FONCTIONNEL dans le header (boutons FR/EN/ES…) qui bascule TOUT le texte du site via JS — méthode : attributs data-i18n + objet JS de traductions, OU blocs .lang-xx affichés/masqués. Traduis l'intégralité du contenu (pas seulement le menu), langue par défaut = la première listée.

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
          max_tokens: planMaxTokens,
          temperature: 0.6,
          stream: true,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
        }),
      });
      if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: parseLlmError(await aiRes.text(), "DeepSeek") }); res.end(); return; }
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

      // ── COMPLÉTION D'UN CODE TRONQUÉ (continuation, pas regénération) ──────
      // Si la génération initiale a été coupée (max_tokens), on continue le code
      // au lieu de le regénérer (qui re-tronque) → évite la page blanche au 1er rendu.
      const genKeys: Partial<Record<Provider, string | null>> = { deepseek: deepseekKey, anthropic: claudeKey };
      if (isHtmlTruncated(fullCode)) {
        const b = fullCode.length;
        pipelineLog('generate:truncated:detected', { len: b });
        fullCode = await completeTruncatedHtml(fullCode, genKeys, "deepseek", res);
        pipelineLog('generate:truncated:completed', { before: b, after: fullCode.length, closed: /<\/html>/i.test(fullCode) });
      }

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
— Navigation one-page : chaque lien de menu href="#id" DOIT avoir sa <section id="id"> (sinon ancre cassée). Une ancre vers une section existante est CORRECTE, ce n'est PAS un bug.
— Si le code utilise onclick="showPage('id')" → la fonction showPage() DOIT exister dans <script> ET chaque id appelé doit avoir sa <section id="id">
— Ne PAS exiger showPage() sur un site one-page (sections empilées) : c'est volontaire et valide
— Balises HTML fermées : </style> </script> </body> </html>
— JS valide : accolades équilibrées, fonctions complètes
— Code complet : pas tronqué (doit finir par </html>)
— Images : src vide ou relatif → doit être URL Unsplash complète`,
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
• Navigation : corrige les ancres cassées en créant la <section id="..."> manquante (ou en corrigeant le lien). Une ancre href="#id" vers une section existante est CORRECTE — ne la transforme PAS en showPage().
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

      // Post-traitement : année courante + crédit Mar-ia obligatoire (génération = toujours présent).
      fullCode = postProcessSite(fullCode, false);

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
      phase?: "reason" | "execute" | "discuss";
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

    const projectFramework = project[0]?.framework || "html";
    const isExpo = projectFramework === "expo";

    const currentVersion = await db.select().from(versions)
      .where(eq(versions.id, project[0].currentVersionId!)).limit(1);
    if (!currentVersion[0]) { res.status(400).json({ error: "Aucune version générée" }); return; }

    // Fetch user plan + all platform keys concurrently
    const [userRow, openaiKeyPlatform, claudeKeyPlatform, qwenKeyPlatform, deepseekKeyPlatform] = await Promise.all([
      db.select().from(users).where(eq(users.id, user.id)).limit(1),
      getPlatformKey("openai"),
      getPlatformKey("anthropic"),
      getPlatformKey("qwen"),
      getPlatformKey("deepseek"),
    ]);
    const u = userRow[0];
    const userPlan = u?.plan || "free";
    const config = PLAN_CONFIGS[userPlan] || PLAN_CONFIGS.free;
    const chatPlanMaxTokens = (PLAN_LIMITS[userPlan as PlanName] || PLAN_LIMITS.free).maxTokensPerGen;

    // Clés personnelles de l'utilisateur (BYOK), indexées par provider, en
    // fallback quand aucune clé plateforme n'est configurée. AVANT : seul
    // DeepSeek avait ce fallback → Anthropic/OpenAI (vision !) restaient nulles
    // même si l'utilisateur avait saisi ses clés en perso → images illisibles.
    const personalKeys: Record<string, string> = {};
    try {
      const rows = await db.select({ provider: apiKeys.provider, encryptedKey: apiKeys.encryptedKey })
        .from(apiKeys).where(eq(apiKeys.userId, user.id));
      for (const r of rows) {
        if (r.provider && !personalKeys[r.provider]) {
          try { personalKeys[r.provider] = decrypt(r.encryptedKey); } catch { /* ignore */ }
        }
      }
    } catch { /* table indispo — ignore */ }

    const claudeKey = claudeKeyPlatform || personalKeys["anthropic"] || null;
    const openaiKey = openaiKeyPlatform || personalKeys["openai"] || null;
    const qwenKey   = qwenKeyPlatform   || personalKeys["qwen"]   || null;
    const deepseekKey = deepseekKeyPlatform || personalKeys["deepseek"] || null;

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

    // ── PHASE DISCUSS : Réflexion projet — aucune modification de code ────
    if (phase === "discuss") {
      pipelineLog('discuss:start', { project: project[0].name, plan: userPlan });

      // Load last 12 chat messages for conversational context
      const chatHistory = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.projectId, projectId))
        .orderBy(desc(chatMessages.createdAt))
        .limit(12);
      chatHistory.reverse();

      // Pick best available LLM (prefer Claude for nuance, fallback chain)
      // resolveKey only checks if a key is configured — the actual call may still fail (quota, credits, etc.)
      // So we build an ordered list and retry on failure instead of stopping at the first pick.
      const discussCandidates: NonNullable<ReturnType<typeof resolveKey>>[] = (
        ["anthropic", "openai", "qwen", "deepseek"] as Provider[]
      ).map(p => resolveKey(p, allKeys)).filter(Boolean) as NonNullable<ReturnType<typeof resolveKey>>[];
      if (discussCandidates.length === 0) { sseWrite(res, "error", { message: "Aucun LLM disponible" }); res.end(); return; }

      const projectDesc = [
        project[0].siteType ? `Type : ${project[0].siteType}` : null,
        project[0].style    ? `Style : ${project[0].style}`   : null,
        project[0].language ? `Langue : ${project[0].language}` : null,
        project[0].description ? `Description : ${project[0].description}` : null,
      ].filter(Boolean).join(" | ");

      const discussSystemPrompt = `Tu es Mar-ia en mode **Réflexion Projet**. Tu es une conseillère stratégique et créative pour le projet "${project[0].name}"${projectDesc ? ` (${projectDesc})` : ""}.

TON RÔLE DANS CE MODE :
• Discuter, explorer et conseiller — JAMAIS générer de code ni modifier le site
• Comprendre et affiner la vision de l'utilisateur pour ce projet
• Suggérer des idées de pages, fonctionnalités, contenus adaptés au projet
• Identifier ce qui est réalisable rapidement vs complexe vs risqué
• Pointer les pièges à éviter (UX, technique, contenu, légal si pertinent)
• Évaluer les demandes : faisabilité, pertinence, priorité
• Poser des questions pour clarifier la vision si besoin

FORMAT DE RÉPONSE :
• Réponds en français, ton bienveillant et expert
• Utilise des listes (✅ / ⚠️ / ❌) quand tu compares des options ou listes des risques
• Sections courtes et claires — évite les blocs de texte denses
• Pose AU MAXIMUM 1-2 questions par réponse
• Utilise **gras** pour les points clés

INTERDICTIONS ABSOLUES :
❌ N'écris JAMAIS de code HTML, CSS, JavaScript, JSX
❌ Ne propose pas de "modifier directement", "générer" ou "créer" du code
❌ Ne décris pas d'implémentation technique en détail
❌ Ne sors jamais du contexte du projet "${project[0].name}"`;

      // Build conversation messages
      const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...chatHistory
          .filter(m => m.content?.trim())
          .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message },
      ];

      // Save user message
      await db.insert(chatMessages).values({ projectId, userId: user.id, role: "user", content: message });

      let fullReply = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let usedLlm = discussCandidates[0];

      // Try each provider in order — stop as soon as one succeeds
      for (const candidate of discussCandidates) {
        sseWrite(res, "progress", { agent: AGENT_NAMES[candidate.provider], step: "Réflexion…", icon: "💬" });
        fullReply = ""; inputTokens = 0; outputTokens = 0;
        let providerOk = false;

        try {
          if (candidate.provider === "anthropic") {
            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": candidate.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model: candidate.model, max_tokens: 1200, temperature: 0.7, stream: true, system: discussSystemPrompt, messages: llmMessages }),
            });
            if (!aiRes.ok || !aiRes.body) {
              pipelineLog('discuss:provider:fail', { provider: candidate.provider, status: aiRes.status, msg: parseLlmError(await aiRes.text()) });
              continue; // try next provider
            }
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
                  if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") { fullReply += evt.delta.text; sseWrite(res, "chunk", { text: evt.delta.text }); }
                  if (evt.type === "message_delta" && evt.usage) outputTokens = evt.usage.output_tokens || 0;
                  if (evt.type === "message_start" && evt.message?.usage) inputTokens = evt.message.usage.input_tokens || 0;
                } catch { /* skip */ }
              }
            }
          } else {
            const baseUrls: Record<string, string> = { deepseek: "https://api.deepseek.com/v1", openai: "https://api.openai.com/v1", qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
            const baseUrl = baseUrls[candidate.provider] || "https://api.openai.com/v1";
            const aiRes = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${candidate.key}`, "content-type": "application/json" },
              body: JSON.stringify({ model: candidate.model, max_tokens: 1200, temperature: 0.7, stream: true, messages: [{ role: "system", content: discussSystemPrompt }, ...llmMessages] }),
            });
            if (!aiRes.ok || !aiRes.body) {
              pipelineLog('discuss:provider:fail', { provider: candidate.provider, status: aiRes.status, msg: parseLlmError(await aiRes.text()) });
              continue; // try next provider
            }
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
                  if (chunk) { fullReply += chunk; sseWrite(res, "chunk", { text: chunk }); }
                  if (evt.usage) { inputTokens = evt.usage.prompt_tokens || 0; outputTokens = evt.usage.completion_tokens || 0; }
                } catch { /* skip */ }
              }
            }
          }
          usedLlm = candidate;
          providerOk = true;
        } catch (err: any) {
          pipelineLog('discuss:provider:exception', { provider: candidate.provider, error: err.message?.slice(0, 100) });
          // continue to next provider
        }

        if (providerOk) break; // success — no need to try more
      }

      if (!fullReply) {
        sseWrite(res, "error", { message: "Tous les modèles IA sont temporairement indisponibles. Réessaie dans quelques instants." });
        res.end(); return;
      }

      // Save AI reply
      if (fullReply) {
        await db.insert(chatMessages).values({ projectId, userId: user.id, role: "assistant", content: fullReply, tokensUsed: inputTokens + outputTokens });
      }

      sseWrite(res, "done", { reply: fullReply, discuss: true });
      pipelineLog('discuss:done', { provider: usedLlm.provider, tokens: inputTokens + outputTokens, len: fullReply.length });
      res.end();
      return;
    }

    // ── API INTENT DETECTION (before reason phase) ────────────────────────
    // Detect if the user wants to connect an API → emit api_key_request if key not stored yet
    const API_KEYWORDS = [
      "connecte", "intègre", "intégrer", "intégration", "connect", "integrate", "api",
      "stripe", "paypal", "twilio", "sendgrid", "mailgun", "openai", "firebase",
      "supabase", "airtable", "notion", "slack", "discord", "google maps", "mapbox",
      "youtube", "twitter", "facebook", "instagram", "shopify", "brevo", "resend",
      "paiement", "payment", "sms", "email", "newsletter", "webhook", "oauth",
    ];
    const msgLower = message.toLowerCase();
    const hasApiIntent = API_KEYWORDS.some((kw) => msgLower.includes(kw));

    if (hasApiIntent && phase === "reason") {
      // Try to identify the API name from the message
      const knownApis: Record<string, string> = {
        stripe: "Stripe", paypal: "PayPal", twilio: "Twilio", sendgrid: "SendGrid",
        mailgun: "Mailgun", openai: "OpenAI", firebase: "Firebase", supabase: "Supabase",
        airtable: "Airtable", notion: "Notion", slack: "Slack", discord: "Discord",
        "google maps": "Google Maps", mapbox: "Mapbox", youtube: "YouTube",
        twitter: "Twitter/X", facebook: "Facebook", instagram: "Instagram",
        shopify: "Shopify", brevo: "Brevo", resend: "Resend",
      };
      let detectedApiName: string | null = null;
      let detectedApiLabel: string | null = null;
      for (const [k, label] of Object.entries(knownApis)) {
        if (msgLower.includes(k)) { detectedApiName = k.replace(" ", "_"); detectedApiLabel = label; break; }
      }

      if (detectedApiName) {
        // Check if key already stored (safe — returns null on any error including missing table)
        let existing = null;
        try { existing = await getIntegrationKey(user.id, detectedApiName, projectId); } catch { /* ignore */ }
        if (!existing) {
          // Emit api_key_request — frontend will show inline input
          sseWrite(res, "api_key_request", {
            apiName: detectedApiName,
            apiLabel: detectedApiLabel,
            message: `Pour connecter ${detectedApiLabel} à votre site, j'ai besoin de votre clé API. Elle sera chiffrée et ne sera jamais exposée dans le code.`,
          });
          // Continue with normal reasoning — user will provide the key in parallel
        }
      }
    }

    // ── PHASE 1: RAISONNEMENT ──────────────────────────────────────────────
    if (phase === "reason") {
      pipelineLog('reason:start', { project: project[0].name, plan: userPlan, consoleErrors: consoleErrors?.length || 0, isExpo });
      const reasonerSystemPrompt = isExpo
        ? `Tu es Mar-ia, experte en React Native / Expo. Analyse le code App.js et la demande.

══ CONTRAINTES TECHNIQUES EXPO SNACK (CRITIQUE) ══
Ces règles sont non-négociables — un écart = app qui crash dans Expo Snack :

INTERDIT (crash Snack) → SOLUTION CORRECTE :
• react-native-maps → ❌ CRASH → ✅ react-native-webview + Leaflet.js OSM (HTML inline)
• react-navigation / expo-router → ❌ CRASH → ✅ navigation via useState uniquement
• @expo/vector-icons → ❌ CRASH → ✅ emojis uniquement comme icônes
• axios / fetch vers API externe → ❌ CORS → ✅ fetch via proxy /api/proxy/call
• TypeScript → ❌ INTERDIT → ✅ JavaScript pur uniquement

PATTERNS CORRECTS à prescrire dans le plan :
• Carte (OSM, Google Maps, géoloc) → WebView + Leaflet HTML inline + react-native-webview
• Authentification → DEUX écrans : RegisterScreen (créer compte) + LoginScreen (se connecter) + navigation useState entre les deux
• Notifications → Alert.alert() de React Native
• Stockage local → AsyncStorage de @react-native-async-storage/async-storage (disponible Snack)
• Animations → Animated de React Native, pas Reanimated

ÉTAPE 1 — CLASSIFIE la demande :
• Bug d'affichage (écran blanc, crash) → cherche : import manquant, composant mal utilisé, prop incorrecte
• Erreur JS → cherche : variable undefined, hook mal utilisé, async/await manquant
• Modification design → identifie les propriétés StyleSheet concernées
• Ajout de fonctionnalité → identifie l'emplacement d'insertion + le pattern correct à utiliser
• Ajout de carte/map → TOUJOURS prescrire le pattern WebView+Leaflet

ÉTAPE 2 — ANALYSE DU CODE (sois précis, cite le code) :
• Cite les composants (View, Text, ScrollView, etc.) concernés
• Pour un bug : cite le composant ou le style problématique
• Pour une modif : cite le StyleSheet key et la propriété à modifier
• Pour un ajout : cite la section du code où insérer ET le pattern technique à utiliser

ÉTAPE 3 — RÉSUMÉ (120 mots max, format STRICT) :
**Demande :** [reformulation précise en 1-2 phrases]
**Diagnostic :** [problèmes concrets trouvés dans le code — cite les éléments réels]
**Actions prévues :**
• [action 1 précise avec le pattern technique si applicable]
• [action 2 précise]
• [...]
**Périmètre :** Composants / Styles / Navigation / Data
**Contraintes techniques :** [liste les patterns obligatoires détectés — ex: "Carte → WebView+Leaflet", "Auth → Register+Login"]

⚠️ Si la demande est vague, propose 3 améliorations concrètes et demande laquelle.`
        : `Tu es Mar-ia, développeuse web senior. Avant de répondre, RAISONNE comme un humain expert : qu'est-ce que l'utilisateur veut VRAIMENT obtenir ? Reformule son objectif réel, pas seulement ses mots.

══ RAISONNE SUR L'INTENTION (le plus important) ══
• Lis la demande + l'historique. Déduis le BUT final, pas la formulation littérale.
• Distingue deux types de tâches :
  — RETOUCHE ciblée (changer une couleur, un texte, ajouter une section) → garde la structure existante.
  — REFONTE structurelle (« tout sur une page », « onepage », « rassembler les blocs », « séparer en pages », « restructurer ») → la structure DOIT changer. Ne réponds pas « modification chirurgicale » : le but EST de transformer l'architecture.
• Si l'intention est claire et à faible risque (ajouter des images sur un site dont le thème est évident, changer un visuel, ajouter une section standard) → NE POSE PAS de question, agis avec des choix par défaut pertinents (ex: images Unsplash thématiques liées au métier du site).
• Ne pose une question QUE si un choix structurant est réellement ambigu ET bloquant.
• Si l'utilisateur référence un fichier/zip qu'il a « envoyé avant » et que tu n'y as pas accès dans ce contexte → dis-le clairement et propose une alternative immédiate (images Unsplash thématiques), sans bloquer.

══ DEUX ARCHITECTURES POSSIBLES — CHOISIS SELON L'INTENTION ══
Les deux fonctionnent dans l'aperçu (les ancres #id déclenchent un scroll fluide, ce N'EST PAS un bug).
1. SITE ONE-PAGE (défilement) — quand l'utilisateur veut « une seule page », « onepage », un menu qui « ramène vers chaque bloc » :
   • Toutes les sections visibles, empilées : <section id="services">, <section id="tarifs">, etc. (AUCUN display:none)
   • Menu = vraies ancres : <a href="#services">Services</a> → scroll vers la section
   • Ajouter html{scroll-behavior:smooth} et scroll-margin-top sur les sections (header fixe)
   • PAS de showPage() — on supprime cette logique si elle existe
2. APP MULTI-PAGES (onglets SPA) — quand l'utilisateur veut de vraies pages distinctes qui se remplacent :
   • Navigation : onclick="showPage('page-id'); return false;"
   • Chaque showPage('id') DOIT avoir sa <section id="id"> remplie
→ Détermine laquelle correspond à la demande et prescris-la explicitement dans le plan. Par défaut, un site vitrine = ONE-PAGE.

ÉTAPE 1 — CLASSIFIE la demande :
• Refonte one-page / multi-page → précise l'architecture cible et ce qu'il faut SUPPRIMER (showPage, display:none) vs garder
• Bug visuel (rien ne s'affiche, blanc) → cherche : code HTML tronqué (ne finit pas par </html>), showPage() manquant alors qu'un lien l'appelle, CSS conflictuel
• Erreur JS (console errors) → cherche : variable undefined, function manquante, JSON invalide
• Bug responsive (mobile cassé) → cherche : overflow hidden manquant, largeur fixe en px sans max-width
• Modification design → identifie les variables CSS et classes concernées
• Ajout de contenu/section → identifie l'emplacement et le style existant à respecter

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
      const codeForReason = isExpo ? fullCode.slice(0, 12000) : fullCode.slice(0, 8000);

      // ── Historique de conversation (CONTEXTE) ──────────────────────────────
      // Sans ça, le raisonneur oublie tout ce qui a été dit aux tours précédents
      // (ex: une image décrite, une consigne donnée plus tôt). On injecte les
      // derniers échanges pour conserver le fil.
      let historyCtx = "";
      try {
        const recent = await db
          .select({ role: chatMessages.role, content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.projectId, projectId))
          .orderBy(desc(chatMessages.createdAt))
          .limit(8);
        recent.reverse();
        if (recent.length > 0) {
          const lines = recent
            .map(m => `${m.role === "user" ? "Utilisateur" : "Mar-ia"}: ${(m.content || "").slice(0, 400)}`)
            .join("\n");
          historyCtx = `\n\nHISTORIQUE DE LA CONVERSATION (contexte — ne le perds jamais de vue) :\n${lines}`;
        }
      } catch { /* historique non bloquant */ }

      const reasonerUserMsg = isExpo
        ? `Demande utilisateur: "${message}"${historyCtx}\n\nApp.js actuel (${project[0].name}):\n${codeForReason}${consoleCtxReason}`
        : `Demande utilisateur: "${message}"${historyCtx}\n\nCode actuel du site (${project[0].name}):\n${codeForReason}${consoleCtxReason}`;

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
      if (images && images.length > 0) {
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
        if (claudeKey) {
          pipelineLog('reason:vision', { images: images.length, provider: 'anthropic' });
          sseWrite(res, "progress", { agent: "Claude", step: "Analyse de l'image…", icon: "👁️" });
          try {
            reasoning = await callSyncVision(claudeKey, "claude-haiku-4-5", visionSystemPrompt, reasonerUserMsg, images, 1000);
            if (reasoning?.text) usedReasoner = { provider: "anthropic", model: "claude-haiku-4-5", key: claudeKey };
          } catch (e) {
            pipelineLog('reason:vision:error', { provider: 'anthropic', error: String(e).slice(0, 100) });
          }
        }
        // Fallback OpenAI GPT-4o vision si pas de clé Claude (ou si Claude a échoué)
        if (!reasoning?.text && openaiKey) {
          pipelineLog('reason:vision', { images: images.length, provider: 'openai' });
          sseWrite(res, "progress", { agent: "GPT-4o", step: "Analyse de l'image…", icon: "👁️" });
          try {
            reasoning = await callSyncVisionOpenAI(openaiKey, visionSystemPrompt, reasonerUserMsg, images, 1000);
            if (reasoning?.text) usedReasoner = { provider: "openai", model: "gpt-4o-mini", key: openaiKey };
          } catch (e) {
            pipelineLog('reason:vision:error', { provider: 'openai', error: String(e).slice(0, 100) });
          }
        }
        // Aucune clé vision dispo (ni Claude ni OpenAI) → on prévient l'utilisateur
        // au lieu d'ignorer l'image en silence.
        if (!reasoning?.text && !claudeKey && !openaiKey) {
          pipelineLog('reason:vision:no-key', { images: images.length });
          sseWrite(res, "progress", { agent: "Mar-ia", step: "⚠️ Lecture d'image indisponible (aucune clé Claude/OpenAI configurée)", icon: "⚠️" });
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
      // Persiste le plan/diagnostic validé pour qu'il reste dans l'historique "en dur"
      if (validatedSummary && validatedSummary.trim() && validatedSummary.trim() !== message.trim()) {
        await db.insert(chatMessages).values({ projectId, userId: user.id, role: "assistant", content: validatedSummary.trim() });
      }

      // ── Load user integrations for this project (inject into executor context) ──
      let storedIntegrations: Array<{ apiName: string; apiLabel: string; baseUrl: string | null; docSummary: string | null }> = [];
      try {
        storedIntegrations = await db
          .select({
            apiName: userIntegrations.apiName,
            apiLabel: userIntegrations.apiLabel,
            baseUrl: userIntegrations.baseUrl,
            docSummary: userIntegrations.docSummary,
          })
          .from(userIntegrations)
          .where(eq(userIntegrations.userId, user.id));
      } catch { /* table may not exist yet — safe to ignore */ }

      const integrationContext = storedIntegrations.length > 0
        ? `\n\n══ INTÉGRATIONS API DISPONIBLES ══\nL'utilisateur a configuré les clés API suivantes. Pour les appeler, utilise TOUJOURS le proxy /api/proxy/call (JAMAIS directement l'API) afin de ne pas exposer la clé dans le code source.\n\nFormat d'appel proxy :\nfetch('/api/proxy/call', {\n  method: 'POST',\n  headers: {'Content-Type':'application/json'},\n  credentials: 'include',\n  body: JSON.stringify({ projectId: ${projectId}, apiName: 'NOM_API', endpoint: '/endpoint', method: 'POST', body: {...} })\n})\n\nIntégrations disponibles :\n${storedIntegrations.map(i => `• ${i.apiLabel} (apiName: "${i.apiName}")${i.baseUrl ? ` — base URL: ${i.baseUrl}` : ''}${i.docSummary ? `\n  Doc: ${i.docSummary}` : ''}`).join('\n')}\n⚠️ Ne jamais écrire de clé API en dur dans le code — toujours passer par /api/proxy/call.`
        : "";

      // No history for execute phase — system prompt already contains task + current code + plan.
      // History only causes confusion (old sessions, wrong tasks).
      const history: typeof chatMessages.$inferSelect[] = [];

      try {
        // ── A : Agent / Planning — avec chaîne de relais ──────────────
        let agentPlan = "";
        {
          const agentSystemPrompt = isExpo
            ? `Tu es un architecte React Native expert. Analyse le code App.js et produis un plan d'intervention précis (200 mots max).

ÉTAPE 1 — INVENTAIRE (lis le code et liste) :
• Composants principaux présents (View, ScrollView, FlatList, etc.)
• StyleSheet keys existants (ex: container, header, card, button)
• Couleurs et valeurs définies dans les styles (ex: backgroundColor: '#6C63FF')
• State hooks présents (ex: const [activeTab, setActiveTab] = useState(0))
• Fonctions et handlers (ex: handlePress, navigateTo, fetchData)

ÉTAPE 2 — PLAN CHIRURGICAL (ne touche QUE ce qui est demandé) :
• Composant : cite l'emplacement exact (dans quel View, après quel composant)
• Style : cite le StyleSheet key et la propriété à modifier avec la nouvelle valeur
• State : cite les hooks à ajouter ou modifier

ÉTAPE 3 — LISTE DE PRÉSERVATION :
Ce qui ne doit PAS être touché : [liste les composants et styles existants à conserver]

RÈGLES : N'utilise que les imports Expo SDK. Garde StyleSheet.create(). Pas de bibliothèques tierces.`
            : `Tu es un architecte web expert. Analyse le code et produis un plan d'intervention précis (200 mots max).

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

RÈGLE NAVIGATION : respecte le pattern du site. One-page → ancres href="#id" vers des <section id="id"> (scroll). Multi-pages → onclick="showPage('id')". Si la tâche est de passer en one-page, supprime showPage() et display:none.`;
          const plan = await tryCallWithFallback(
            allKeys, agentSystemPrompt,
            `Tâche: ${summary}\n\nCode actuel (extrait):\n${codeSnippet}`,
            900, res, "Planification des modifications…", "🤖",
            config.agent
          );
          if (plan) agentPlan = plan.text;
        }

        // ── B : Pré-exécution (Agency: 2 exécutants) — avec relais ────
        let qwenDraft = "";
        if (config.executors.length > 1) {
          const qwenSystemPrompt = isExpo
            ? `Tu es un développeur React Native expert. Génère les snippets précis à intégrer dans le code App.js existant.
Pour chaque snippet : indique l'emplacement exact (dans quel composant, après quelle ligne).
Réutilise les StyleSheet keys existants. N'utilise que des imports Expo SDK.
Pas de bibliothèques tierces. Garde StyleSheet.create() pour tous les styles.`
            : `Tu es un développeur frontend expert. Génère les snippets précis à intégrer dans le code existant (pas le HTML complet).
Pour chaque snippet : indique l'emplacement exact (après quelle balise / dans quelle classe CSS / dans quelle fonction JS).
Réutilise les variables CSS et classes existantes. Respecte le style du code actuel.
NAVIGATION : respecte le pattern existant (one-page = ancres href="#id" ; multi-pages = showPage). N'impose pas showPage sur un site one-page.`;
          const draft = await tryCallWithFallback(
            allKeys, qwenSystemPrompt,
            `Plan: ${agentPlan}\nTâche: ${summary}\nCode existant:\n${codeSnippet}`,
            1200, res, "Préparation des modifications…", "⚙️",
            "qwen"
          );
          if (draft) qwenDraft = draft.text;
        }

        // ── C : Exécution streaming — avec chaîne de relais ─────────────
        const execStartProvider = config.executors[config.executors.length - 1];

        const systemPrompt = isExpo
          ? `Tu es Mar-ia, développeuse React Native / Expo senior. Tu travailles sur l'app "${project[0].name}".

TÂCHE : ${summary}

FORMAT DE RÉPONSE — UN SEUL JSON BRUT, RIEN AVANT, RIEN APRÈS :
• Modification du code → {"action":"modify","reply":"[1-2 phrases décrivant le changement]","code":"import React from 'react';\n..."}
• Question conversationnelle (aucun changement de code) → {"action":"chat","reply":"[réponse]"}
⚠️ Tout changement visuel, ajout de composant, correction de bug → action="modify" OBLIGATOIRE.

══ RÈGLE 1 — LIRE AVANT D'ÉCRIRE ══
Analyse le code App.js actuel ci-dessous. Identifie EXACTEMENT :
• Les composants importés (View, Text, ScrollView, TouchableOpacity, etc.) → GARDE CES IMPORTS
• Les StyleSheet keys existants (container, header, card, etc.) → RÉUTILISE-LES
• Les couleurs définies dans les styles → PRÉSERVE LA PALETTE
• Les hooks useState/useEffect existants → CONSERVE-LES si non modifiés
• Les fonctions handler existantes → CONSERVE-LES si non modifiées

══ RÈGLE 2 — MODIFICATION CHIRURGICALE ══
Change UNIQUEMENT ce que la tâche demande. Préserve intégralement :
composants existants, styles, couleurs, logique métier, imports non modifiés.
N'ajoute rien de non demandé. N'efface rien qui fonctionne.

══ RÈGLE 3 — CODE EXPO VALIDE ══
• N'utilise QUE des composants et APIs disponibles dans Expo SDK (react-native, expo, expo-status-bar, expo-linear-gradient, etc.)
• PAS de bibliothèques tierces non disponibles dans Expo Snack (pas de react-navigation seul, pas de axios, etc.)
• CARTE/MAP — chargement DYNAMIQUE OBLIGATOIRE (l'import statique crash la preview web Snack) :
  const WebViewNative = Platform.OS !== 'web' ? require('react-native-webview').WebView : null;
  Puis dans le composant : if (!WebViewNative) return <PlaceholderCarte/>; return <WebViewNative source={{html:mapHtml}} style={{flex:1}}/>;
• Tous les styles dans StyleSheet.create() — pas de styles inline complexes
• Garde les dimensions relatives (flex, %, Dimensions.get) — pas de valeurs px absolues qui cassent sur différents écrans
• Platform.OS pour les différences iOS/Android/web si nécessaire

══ RÈGLE 4 — CODE 100% COMPLET ══
Retourne le fichier App.js ENTIER. Jamais tronqué. Jamais raccourci avec "// reste du code".
La dernière ligne doit être "export default App;" ou équivalent.
Si le code actuel fait 3000 caractères, ta réponse doit faire au moins autant.

══ RÈGLE 5 — QUALITÉ VISUELLE PREMIUM ══
• Nouvelles sections : StyleSheet cohérent avec l'existant (mêmes rayons, ombres, couleurs)
• Texte réaliste et dense — JAMAIS de placeholder "Lorem ipsum" ou "Texte ici"
• Boutons avec activeOpacity={0.8}, padding suffisant, border-radius cohérent
• ScrollView avec showsVerticalScrollIndicator={false} pour un look propre
• Icônes : utilise des emojis ou @expo/vector-icons si déjà importé

══ APP.JS ACTUEL (v${currentVersion[0].versionNumber}) — LIS ATTENTIVEMENT AVANT D'ÉCRIRE ══
${currentVersion[0].generatedCode || ""}
${agentPlan ? `\n══ PLAN D'ACTION ══\n${agentPlan}` : ""}${qwenDraft ? `\n\n══ SNIPPETS PRÉPARÉS ══\n${qwenDraft}` : ""}${consoleErrors && consoleErrors.length > 0 ? `\n\n══ ERREURS DÉTECTÉES (console) ══\n${consoleErrors.slice(0, 8).map((e, i) => `${i + 1}. ${e}`).join('\n')}\n⚠️ Corrige TOUTES ces erreurs en plus de la tâche principale.` : ""}`
          : `Tu es Mar-ia, développeuse web senior. Tu travailles sur le projet "${project[0].name}".

TÂCHE : ${summary}

FORMAT DE RÉPONSE — UN SEUL JSON BRUT, RIEN AVANT, RIEN APRÈS :
• Changement CSS pur (scrollbars, couleurs, spacing, padding, animations CSS, border, opacity, font-size, transitions) → {"action":"style-patch","reply":"[1-2 phrases]","css":"/* CSS complet à injecter dans le <style> existant */"}
  → Utilise style-patch pour TOUT changement qui ne touche QUE au CSS : c'est plus rapide, plus fiable, préserve tout le code.
• Modification du site (HTML, JS, nouveau contenu, nouvelle section) → {"action":"modify","reply":"[1-2 phrases courtes décrivant ce qui a changé]","code":"<!DOCTYPE html>..."}
• Question conversationnelle pure (aucun changement visuel) → {"action":"chat","reply":"[réponse]"}
⚠️ Tout changement visuel, ajout de contenu, correction de bug → action="modify" ou "style-patch" OBLIGATOIRE.

══ RÈGLE 1 — LIRE AVANT D'ÉCRIRE ══
Analyse le code actuel fourni ci-dessous. Identifie EXACTEMENT :
• Les variables CSS déjà définies (--c-primary, --c-bg, --font-display, etc.) → RÉUTILISE-LES sans exception
• Les classes CSS existantes (card, btn-primary, section-title, etc.) → RÉUTILISE-LES
• Les fonctions JS présentes (showPage, toggleMenu, handleForm, etc.) → CONSERVE-LES
• Les sections/pages (id="page-xxx") → NE LES SUPPRIME PAS, même si non mentionnées — SAUF si la tâche est une refonte structurelle qui l'exige (voir RÈGLE 2)
• Les animations IntersectionObserver → CONSERVE-LES si présentes

══ RÈGLE 2 — RETOUCHE CIBLÉE vs REFONTE STRUCTURELLE (RAISONNE D'ABORD) ══
Demande-toi : la tâche veut-elle RETOUCHER l'existant, ou TRANSFORMER l'architecture ?

• RETOUCHE CIBLÉE (couleur, texte, image, ajout d'une section) → modification chirurgicale :
  change UNIQUEMENT ce qui est demandé, préserve animations, sections, formulaires, palette, polices, JS, nav.
  Si la tâche est "changer la couleur du bouton", ne touche QUE au bouton.

• REFONTE STRUCTURELLE (« tout sur une page », « onepage », « rassembler les blocs », « séparer en pages », « restructurer la navigation ») → la modification chirurgicale NE S'APPLIQUE PAS :
  le but EST de changer la structure. Tu DOIS alors supprimer/réécrire ce qui l'empêche (showPage, display:none, anciens liens).
  Préserve le CONTENU et le DESIGN (textes, couleurs, sections, images), mais reconstruis l'ARCHITECTURE demandée.
  ❌ Erreur grave : répondre "Corrections appliquées" en gardant l'ancienne structure intacte → l'utilisateur ne voit aucun changement.

══ RÈGLE 3 — NAVIGATION : CHOISIS LE BON PATTERN SELON L'INTENTION ══
Les deux patterns fonctionnent dans l'aperçu. Les ancres #id déclenchent un scroll fluide (géré par l'aperçu), ce N'EST PAS un bug.

A. SITE ONE-PAGE (défilement — cas par défaut d'un site vitrine, et OBLIGATOIRE si l'utilisateur demande "une seule page / onepage / menu qui ramène vers chaque bloc") :
   • Toutes les sections empilées et visibles : <section id="services">, <section id="tarifs">… AUCUN display:none
   • Menu = vraies ancres : <a href="#services">Services</a> (scroll vers la section)
   • Ajoute dans le CSS : html{scroll-behavior:smooth} et scroll-margin-top:80px sur les sections (compense le header fixe)
   • SUPPRIME toute fonction showPage() et tout style display:none de masquage de sections
   • Le logo → <a href="#accueil"> ou href="#top"

B. APP MULTI-PAGES (onglets qui se remplacent — uniquement si l'utilisateur veut de vraies pages distinctes) :
   • Liens nav → <a href="#" onclick="showPage('page-id'); return false;">
   • showPage(id) DOIT exister dans le <script>
   • ⚠️ PAGES FANTÔMES : pour CHAQUE showPage('xxx'), il DOIT exister <section id="xxx"> remplie de vrai contenu. Un lien sans section = page blanche.

→ Détermine le pattern d'après la demande. Ne force JAMAIS le pattern B quand l'utilisateur demande explicitement une seule page.
AVANT DE FINIR : vérifie que chaque lien de nav mène quelque part (ancre vers une section existante, ou showPage vers une section existante).

══ RÈGLE 4 — CODE 100% COMPLET ══
Retourne le fichier HTML ENTIER. Jamais tronqué. Jamais raccourci avec des commentaires "// reste du code".
Fermetures OBLIGATOIRES : </style> </script> </body> </html>
Si le code actuel fait 15 000 caractères, ta réponse doit faire au moins autant.

══ RÈGLE 5 — QUALITÉ VISUELLE PREMIUM (OBLIGATOIRE POUR TOUTE MODIFICATION) ══
• Images : https://images.unsplash.com/photo-{ID}?w=800&h=600&fit=crop&q=80 (IDs réels, pas de placeholder)
• Formulaires : onsubmit="e.preventDefault(); [masque form, affiche message succès animé]"
• Responsive : mobile-first, breakpoints @media (min-width: 640px) et @media (min-width: 1024px)
• Nouvelles sections : même style que l'existant (variables CSS, typographie, spacing), PLUS :
  — Cards avec border-radius var(--radius), box-shadow var(--shadow), hover transform+shadow
  — Icônes SVG inline (pas de CDN) ou emojis significatifs — jamais de placeholders vides
  — Texte dense et réaliste (min 80 mots par section) — JAMAIS lorem ipsum ni "description de service"
  — CTA avec gradient ou couleur primaire, border-radius var(--radius-lg), height:52px min, transition var(--transition)
• Si le héro existant est basique (fond uni, image manquante) → remplace par : gradient bold OU image Unsplash avec overlay
• Si les animations IntersectionObserver sont absentes → ajoute-les systématiquement
• Témoignages : toujours avec avatar CSS (initiales + couleur primaire), étoiles ★, nom + poste fictif
• Stats : fond dégradé ou sombre, compteurs, typographie xl (clamp(2rem,5vw,3.5rem))

══ RÈGLE 6 — IMAGES JOINTES PAR L'UTILISATEUR ══
Si une image est jointe ET que le plan d'action liste des éléments numérotés à créer :
• Crée une <section id="..."> complète pour CHAQUE élément listé, dans l'ordre
• Ne passe à la section suivante qu'après avoir terminé la précédente
• Chaque section doit avoir du VRAI contenu (titre, texte, éléments HTML) — pas de placeholder
• Après avoir créé toutes les sections, vérifie que chaque showPage('id') a bien sa section correspondante
• Si tu manques de place (token limit) : réduis le CSS et le contenu des sections existantes pour faire tenir toutes les nouvelles

══ CODE ACTUEL (v${currentVersion[0].versionNumber}) — LIS ATTENTIVEMENT AVANT D'ÉCRIRE ══
${currentVersion[0].generatedCode || ""}
${agentPlan ? `\n══ PLAN D'ACTION ══\n${agentPlan}` : ""}${qwenDraft ? `\n\n══ SNIPPETS PRÉPARÉS ══\n${qwenDraft}` : ""}${consoleErrors && consoleErrors.length > 0 ? `\n\n══ ERREURS JS ACTIVES DANS LA PREVIEW (console navigateur) ══\n${consoleErrors.slice(0, 8).map((e, i) => `${i + 1}. ${e}`).join('\n')}\n⚠️ Corrige TOUTES ces erreurs JS en plus de la tâche principale.` : ""}${integrationContext}`;

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

        // ── Sélectionne un exécuteur via chaîne de relais (HTTP 200 = ok) ──
        const execChainStart = FALLBACK_CHAIN.indexOf(execStartProvider);
        const execChain = (execChainStart >= 0 ? FALLBACK_CHAIN.slice(execChainStart) : [...FALLBACK_CHAIN]) as Provider[];
        let execLlm: { provider: Provider; model: string; key: string } | null = null;
        let execAiRes: globalThis.Response | null = null;
        let execIsAnthropic = false;

        for (const p of execChain) {
          const k = allKeys[p];
          if (!k) continue;
          sseWrite(res, "progress", { agent: AGENT_NAMES[p], step: "Génération du code complet…", icon: "💻" });
          try {
            let candidate: globalThis.Response;
            if (p === "anthropic") {
              candidate = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31", "content-type": "application/json" },
                body: JSON.stringify({ model: PROVIDER_MODELS[p], max_tokens: chatPlanMaxTokens, temperature: 0.3, stream: true, system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }], messages: llmMessages }),
              });
            } else {
              const baseUrls: Record<string, string> = { deepseek: "https://api.deepseek.com/v1", openai: "https://api.openai.com/v1", qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
              const baseUrl = baseUrls[p] || "https://api.openai.com/v1";
              // Adapt image blocks: Anthropic format → OpenAI image_url format
              const adaptedMsgs = llmMessages.map((m: any) => {
                if (m.role === "user" && Array.isArray(m.content)) {
                  return { ...m, content: m.content.map((b: any) => b.type === "image" && b.source?.type === "base64" ? { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}`, detail: "high" } } : b) };
                }
                return m;
              });
              const wrappedMessages = adaptedMsgs.map((m: any) => m.role === "assistant" ? { ...m, content: `{"action":"chat","reply":${JSON.stringify(m.content)}}` } : m);
              candidate = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${k}`, "content-type": "application/json" },
                body: JSON.stringify({ model: PROVIDER_MODELS[p], max_tokens: chatPlanMaxTokens, temperature: 0.3, stream: true, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, ...wrappedMessages] }),
              });
            }
            if (candidate.ok && candidate.body) {
              execLlm = { provider: p, model: PROVIDER_MODELS[p], key: k };
              execAiRes = candidate;
              execIsAnthropic = (p === "anthropic");
              break;
            }
            const errTxt = await candidate.text().catch(() => "");
            pipelineLog('execute:stream:fail', { provider: p, status: candidate.status, err: errTxt.slice(0, 200) });
            const nextP = execChain.slice(execChain.indexOf(p) + 1).find(np => allKeys[np]);
            if (nextP) sseWrite(res, "progress", { agent: AGENT_NAMES[p], step: `Indisponible — relais ${AGENT_NAMES[nextP]}…`, icon: "⏭️" });
          } catch (fetchErr: any) {
            pipelineLog('execute:stream:exception', { provider: p, error: fetchErr?.message?.slice(0, 100) });
            const nextP = execChain.slice(execChain.indexOf(p) + 1).find(np => allKeys[np]);
            if (nextP) sseWrite(res, "progress", { agent: AGENT_NAMES[p], step: `Indisponible — relais ${AGENT_NAMES[nextP]}…`, icon: "⏭️" });
          }
        }

        if (!execLlm || !execAiRes?.body) { sseWrite(res, "error", { message: "Aucun LLM d'exécution disponible" }); res.end(); return; }

        const startTime = Date.now();
        let fullRaw = ""; let inputTokens = 0; let outputTokens = 0;

        {
          const reader = execAiRes.body.getReader(); const dec = new TextDecoder(); let buf = "";
          if (execIsAnthropic) {
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

        // ── D0 : Style-patch — injection CSS pure (rapide, sans régénération) ──
        // When the executor detects a CSS-only change it outputs action="style-patch"
        // with a "css" field. We inject that CSS into the existing <style> block
        // instead of regenerating the whole HTML. This is reliable for scrollbar,
        // colour, spacing, animation changes.
        const agentExt = agentResponse as { action: string; code?: string; reply: string; css?: string };
        if (!isExpo && agentExt.action === "style-patch" && agentExt.css) {
          const existingCode = currentVersion[0].generatedCode || "";
          const cssBlock = `\n/* === patch — ${summary.slice(0, 60)} === */\n${agentExt.css}\n`;
          // Inject before the LAST </style> tag so it overrides earlier rules
          const patched = existingCode.includes('</style>')
            ? existingCode.replace(/(<\/style>)(?![\s\S]*<\/style>)/i, `${cssBlock}</style>`)
            : existingCode + `<style>${cssBlock}</style>`;
          agentResponse.code = patched;
          agentResponse.action = "modify";
          pipelineLog('execute:style-patch', { cssLen: agentExt.css.length });
        }

        // ── D0 : Complétion d'un code TRONQUÉ (avant toute validation) ────
        // Si la génération a été coupée (max_tokens), on CONTINUE le code au lieu
        // de le regénérer (qui re-tronque) — sinon l'utilisateur voit une page blanche.
        if (!isExpo && agentResponse.action === "modify" && isHtmlTruncated(agentResponse.code || "")) {
          const beforeLen = agentResponse.code!.length;
          pipelineLog('execute:truncated:detected', { len: beforeLen });
          agentResponse.code = await completeTruncatedHtml(agentResponse.code!, allKeys, execLlm!.provider, res);
          pipelineLog('execute:truncated:completed', { before: beforeLen, after: agentResponse.code.length, closed: /<\/html>/i.test(agentResponse.code) });
        }

        // ── D : Validation + boucle auto-correction (max 2 passes) ────
        // Skip HTML-specific validation for Expo/React Native code (App.js never has </html>)
        if (!isExpo && agentResponse.action === "modify" && agentResponse.code) {
          for (let pass = 1; pass <= 2; pass++) {
            // ── D1 : Validateur statique (gratuit, instantané) ─────────
            const staticIssues = validateGeneratedCode(agentResponse.code!);
            pipelineLog(`validate:static:pass${pass}`, { plan: userPlan, issues: staticIssues.length, detail: staticIssues });

            // ── D2 : LLM contrôleur — SEULEMENT si problèmes statiques détectés ──
            // Running the LLM controller on every modification produces false positives
            // and triggers unnecessary correction passes that degrade the output.
            let llmIssues = "";
            if (staticIssues.length > 0) {
              const ctrl = await tryCallWithFallback(
                allKeys,
                `Tu es un expert QA développement web. Inspecte ce code HTML/CSS/JS et liste les problèmes CONCRETS.
Réponds UNIQUEMENT "OK" si tout est correct. Sinon, liste chaque problème en 1 ligne (80 mots max total).

VÉRIFIE UNIQUEMENT :
— Ancres cassées : un lien href="#id" sans <section id="id"> correspondante. Une ancre vers une section existante est CORRECTE (one-page valide), ne la signale PAS.
— Si onclick="showPage('id')" est utilisé → la fonction showPage() doit exister dans <script> et chaque id doit avoir sa section. Ne PAS exiger showPage sur un site one-page.
— Balises fermées : </style> </script> </body> </html>
— Code complet (pas tronqué en milieu de section ou de balise)`,
                (agentResponse.code || "").slice(0, 10000), 300,
                res, `Vérification qualité (passe ${pass})…`, "🔍",
                config.controller
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

            // ── D3 : Auto-correction — passe le code problématique comme input ──
            // FIX: previously passed `summary` (task description) as the user message,
            // so the model corrected in the dark without seeing the broken code.
            // Now we pass the actual broken code + the issue list.
            pipelineLog(`validate:pass${pass}:issues`, { count: allIssues.length, issues: allIssues });
            if (pass === 2) {
              pipelineLog('validate:max_retries', { message: 'livraison avec code actuel' });
              break;
            }

            const fixSystemPrompt = `Tu es un expert développeur web. Corrige UNIQUEMENT les problèmes listés dans ce code HTML. Ne modifie rien d'autre.
FORMAT STRICT — un seul JSON brut :
{"action":"modify","reply":"Corrections appliquées.","code":"<!DOCTYPE html>...code complet corrigé..."}

RÈGLES DE CORRECTION :
— Ancres/pages cassées : crée la <section id="xxx"> manquante avec du vrai contenu. Ne transforme PAS une ancre href="#id" valide en showPage().
— Balises non fermées : ferme </style> </script> </body> </html>
— Retourne le HTML ENTIER, pas tronqué. Si le code original fait N chars, ta réponse doit faire au moins autant.

PROBLÈMES À CORRIGER :
${allIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`;

            const retry = await tryCallWithFallback(
              allKeys, fixSystemPrompt,
              `CODE HTML À CORRIGER :\n${agentResponse.code?.slice(0, 14000) || ""}`,
              16000, res, `Correction auto (passe ${pass})…`, "🔄",
              execLlm!.provider
            );
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

        // ── D-EXPO : Vérification + boucle auto-correction Expo (max 1 passe) ──
        // Equivalent du bloc D HTML mais adapté React Native : vérifie imports interdits
        // et complétude de la tâche. Si problème → Claude corrige + DeepSeek regénère.
        if (isExpo && agentResponse.action === "modify" && agentResponse.code) {
          // D-EXPO-1 : Check statique — imports interdits détectés par regex
          const FORBIDDEN_EXPO = [
            { pattern: /import.*react-native-maps/i,       fix: "Remplace react-native-maps par react-native-webview + Leaflet HTML inline" },
            { pattern: /import.*@react-navigation/i,       fix: "Remplace react-navigation par une navigation useState (switchTab ou setScreen)" },
            { pattern: /import.*expo-router/i,             fix: "Remplace expo-router par une navigation useState" },
            { pattern: /import.*@expo\/vector-icons/i,     fix: "Remplace @expo/vector-icons par des emojis (ex: 🏠 👤 ⚙️)" },
            { pattern: /import.*react-native-reanimated/i, fix: "Remplace react-native-reanimated par Animated de React Native" },
            { pattern: /import.*axios/i,                   fix: "Remplace axios par fetch natif" },
          ];
          const staticIssuesExpo: string[] = [];
          for (const { pattern, fix } of FORBIDDEN_EXPO) {
            if (pattern.test(agentResponse.code)) {
              staticIssuesExpo.push(fix);
            }
          }

          // D-EXPO-2 : LLM contrôleur — vérifie que la tâche est accomplie (avec relais)
          let llmIssuesExpo = "";
          if (staticIssuesExpo.length === 0) {
            // Only run LLM check if static check passed (no forbidden imports)
            const ctrl = await tryCallWithFallback(
              allKeys,
              `Tu es un expert QA React Native / Expo. Vérifie que le code App.js généré accomplit la tâche demandée.
Réponds UNIQUEMENT "OK" si tout est correct. Sinon, liste chaque problème en 1 ligne (80 mots max total).

VÉRIFIE UNIQUEMENT :
— La tâche demandée est-elle réalisée ? (fonctionnalité présente dans le code)
— Si "carte" / "map" demandée → WebView + Leaflet présent ? (pas react-native-maps)
— Si "auth" / "connexion" / "compte" demandé → RegisterScreen ET LoginScreen présents ?
— Export default App() présent en fin de fichier ?
— StyleSheet.create() utilisé pour tous les styles ?

TÂCHE DEMANDÉE : ${summary}`,
              `CODE APP.JS GÉNÉRÉ :\n${agentResponse.code.slice(0, 8000)}`,
              400, res, "Vérification qualité du code…", "🔍",
              config.controller
            );
            if (ctrl && ctrl.text.trim() !== "OK") llmIssuesExpo = ctrl.text.trim();
          }

          const allIssuesExpo = [...staticIssuesExpo, ...(llmIssuesExpo ? [llmIssuesExpo] : [])];

          if (allIssuesExpo.length > 0) {
            pipelineLog('validate:expo:issues', { issues: allIssuesExpo });

            const expoFixPrompt = `Tu es un expert React Native Expo. Corrige UNIQUEMENT les problèmes listés dans ce code App.js.
Ne modifie rien d'autre que ce qui est demandé dans les corrections.

FORMAT STRICT — un seul JSON brut :
{"action":"modify","reply":"Corrections appliquées.","code":"import React..."}

CORRECTIONS À APPLIQUER :
${allIssuesExpo.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

RAPPEL IMPORTS AUTORISÉS : react-native built-ins, expo-linear-gradient, react-native-webview
RAPPEL NAVIGATION : uniquement via useState, pas de librairie
RAPPEL ICÔNES : uniquement des emojis`;

            const retry = await tryCallWithFallback(
              allKeys, expoFixPrompt,
              `CODE APP.JS À CORRIGER :\n${agentResponse.code.slice(0, 12000)}`,
              14000, res, "Correction automatique…", "🔄",
              execLlm!.provider
            );

            if (retry) {
              let corrected: { action: string; code?: string; reply: string } | null = null;
              try { corrected = JSON.parse(retry.text.trim()); }
              catch {
                try { corrected = JSON.parse(extractJsonObject(retry.text) ?? retry.text); }
                catch {
                  const jsStart = retry.text.indexOf("import React");
                  if (jsStart >= 0) {
                    corrected = { action: "modify", reply: "Corrections appliquées.", code: retry.text.slice(jsStart) };
                  }
                }
              }
              if (corrected?.code) {
                agentResponse = corrected;
                pipelineLog('validate:expo:corrected', { codeLen: corrected.code.length });
              }
            }
          } else {
            pipelineLog('validate:expo:ok');
          }
        }

        // ── E : Sauvegarde version ─────────────────────────────────────
        let versionId: number | null = null;
        const _allUsed = [config.agent, ...config.executors, config.controller].map(p => PROVIDER_MODELS[p]);
        const usedModels = _allUsed.filter((v, i) => _allUsed.indexOf(v) === i).join("+");

        if (agentResponse.action === "modify" && agentResponse.code) {
          const nextVersionNumber = totalVersions + 1;
          // Sites web (pas Expo) : année courante + crédit Mar-ia. Les comptes
          // payants peuvent retirer le crédit via le chat ; les gratuits non.
          if (!isExpo) {
            agentResponse.code = postProcessSite(agentResponse.code, userPlan !== "free");
          }
          const [versionResult] = await db.insert(versions).values({
            projectId, userId: user.id,
            versionNumber: nextVersionNumber,
            label: `Version ${nextVersionNumber} — ${message.slice(0, 50)}`,
            prompt: message, generatedCode: agentResponse.code,
            tokensUsed, generationTimeMs: durationMs,
            model: usedModels || execLlm!.model, status: "ready",
          }).returning({ id: versions.id });
          versionId = versionResult.id;

          // ── Expo : republish Snack with updated code + correct dependencies ──
          // Without this, the Snack still shows the old code after a chat modification,
          // and any newly imported package (e.g. react-native-webview) causes a red screen.
          if (isExpo) {
            try {
              sseWrite(res, "progress", { agent: "Expo", step: "Mise à jour du Snack…", icon: "🚀" });
              const snackSaveRes = await fetch("https://exp.host/--/api/v2/snack/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  manifest: {
                    name: project[0].name,
                    description: `Application générée par Mar-ia — ${project[0].siteType || "App mobile"}`,
                    sdkVersion: "54.0.0",
                  },
                  code: { "App.js": { type: "CODE", contents: agentResponse.code } },
                  dependencies: {
                    "expo": "~54.0.0",
                    "react": "18.3.1",
                    "react-native": "0.76.7",
                    "expo-linear-gradient": "~15.0.8",
                    "react-native-webview": "13.10.5",
                  },
                }),
                signal: AbortSignal.timeout(20000),
              });
              if (snackSaveRes.ok) {
                const snackData = await snackSaveRes.json() as any;
                const newSnackId = snackData.hashId || snackData.id || "";
                if (newSnackId) {
                  const newSnackUrl = `https://snack.expo.dev/${newSnackId}`;
                  await db.update(projects).set({ currentVersionId: versionId, previewUrl: newSnackUrl }).where(eq(projects.id, projectId));
                  pipelineLog("expo:snack:updated", { snackId: newSnackId });
                  // Inject snackUrl into the done event so client refreshes the QR
                  (agentResponse as any)._snackUrl = newSnackUrl;
                  (agentResponse as any)._snackId = newSnackId;
                } else {
                  await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, projectId));
                }
              } else {
                pipelineLog("expo:snack:update-failed", { status: snackSaveRes.status });
                await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, projectId));
              }
            } catch (snackErr: any) {
              pipelineLog("expo:snack:update-error", { error: snackErr?.message });
              await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, projectId));
            }
          } else {
            await db.update(projects).set({ currentVersionId: versionId }).where(eq(projects.id, projectId));
          }
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
          // Pass new Snack URL if Expo project was re-published (client refreshes QR code)
          snackUrl: (agentResponse as any)._snackUrl || null,
          snackId: (agentResponse as any)._snackId || null,
        });

        // ── G : Suggestions A/B/C — relais silencieux (après "done") ──
        {
          const suggestSys = `Tu es Mar-ia. Propose 3 améliorations concrètes et variées pour continuer à enrichir ce site.
Format JSON STRICT (un seul tableau, rien d'autre) :
[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."}]

Règles :
• 7-12 mots par suggestion — actionnable, précise, spécifique au projet
• Couvre 3 axes DIFFÉRENTS parmi : contenu, design, fonctionnalité, SEO, conversion, mobile, animation
• Commence par un verbe d'action : "Ajouter...", "Améliorer...", "Créer...", "Optimiser...", "Intégrer..."
• Pas de guillemets doubles dans les textes (utilise des apostrophes si besoin)
• Pas de suggestion déjà faite dans la modification en cours`;
          const suggestUser = `Projet: ${project[0].name} (${project[0].siteType || "site web"})\nDernière modification: ${assistantReply.slice(0, 300)}\nType de site: ${project[0].siteType || "landing page"}`;
          // Silent loop — no progress events after "done" was already sent
          const suggestChainStart = FALLBACK_CHAIN.indexOf(config.suggester);
          const suggestChain = (suggestChainStart >= 0 ? FALLBACK_CHAIN.slice(suggestChainStart) : [...FALLBACK_CHAIN]) as Provider[];
          for (const p of suggestChain) {
            const k = allKeys[p];
            if (!k) continue;
            const suggestResult = await tryCallSync(p, PROVIDER_MODELS[p], k, suggestSys, suggestUser, 350);
            if (suggestResult?.text) {
              try {
                const extracted = extractJsonObject(suggestResult.text);
                const suggestions = JSON.parse(extracted ?? suggestResult.text);
                if (Array.isArray(suggestions)) { sseWrite(res, "suggestions", { suggestions }); break; }
              } catch { /* skip malformed */ }
            }
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

    const { projectId, screenshot, screenshotMimeType = "image/jpeg", consoleErrors } = req.body as {
      projectId: number;
      screenshot?: string;       // base64, no data: prefix
      screenshotMimeType?: string;
      consoleErrors?: string[];
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
    const [claudeKeyP, openaiKeyP, deepseekKeyP, debugUserRow] = await Promise.all([
      getPlatformKey("anthropic"),
      getPlatformKey("openai"),
      getPlatformKey("deepseek"),
      db.select({ plan: users.plan }).from(users).where(eq(users.id, user.id)).limit(1),
    ]);
    // Fallback vers les clés personnelles (BYOK) de l'utilisateur, par provider.
    const debugPersonal: Record<string, string> = {};
    try {
      const rows = await db.select({ provider: apiKeys.provider, encryptedKey: apiKeys.encryptedKey })
        .from(apiKeys).where(eq(apiKeys.userId, user.id));
      for (const r of rows) {
        if (r.provider && !debugPersonal[r.provider]) {
          try { debugPersonal[r.provider] = decrypt(r.encryptedKey); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    const claudeKey = claudeKeyP || debugPersonal["anthropic"] || null;
    const openaiKey = openaiKeyP || debugPersonal["openai"] || null;
    const deepseekKey = deepseekKeyP || debugPersonal["deepseek"] || null;
    const debugPlanMaxTokens = (PLAN_LIMITS[(debugUserRow[0]?.plan || "free") as PlanName] || PLAN_LIMITS.free).maxTokensPerGen;

    const versionCount = await db.select({ count: count() }).from(versions).where(eq(versions.projectId, projectId));
    const nextVersionNumber = (versionCount[0]?.count || 0) + 1;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    pipelineLog('debug:start', { project: project[0].name, hasScreenshot: !!screenshot, screenshotLen: screenshot?.length || 0, consoleErrors: consoleErrors?.length || 0 });

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

      const consoleSection = consoleErrors && consoleErrors.length > 0
        ? `\n\n══ ERREURS JS CAPTURÉES (console du navigateur) ══\n${consoleErrors.slice(0, 10).map((e, i) => `${i + 1}. ${e}`).join('\n')}\n⚠️ Ces erreurs DOIVENT être réparées en PRIORITÉ ABSOLUE — elles cassent le site pour l'utilisateur.`
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
${consoleSection}${visualSection}

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
          body: JSON.stringify({ model: execModel, max_tokens: debugPlanMaxTokens, stream: true, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: parseLlmError(await aiRes.text(), "Claude") }); res.end(); return; }
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
          body: JSON.stringify({ model: execModel, max_tokens: debugPlanMaxTokens, temperature: 0.2, stream: true, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }] }),
        });
        if (!aiRes.ok || !aiRes.body) { sseWrite(res, "error", { message: parseLlmError(await aiRes.text(), execProvider) }); res.end(); return; }
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

      // Année courante + crédit Mar-ia (payant peut le retirer via chat).
      fixedCode = postProcessSite(fixedCode, (debugUserRow[0]?.plan || "free") !== "free");

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

  // ── POST /api/proxy/call ──────────────────────────────────────────────────
  // Proxy HTTP requests on behalf of a user's stored integration key.
  // Called by the generated site code so the real API key is never exposed.
  //
  // Body: { projectId, apiName, endpoint, method?, headers?, body? }
  // The projectId is used to look up the right integration key.
  app.post("/api/proxy/call", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { projectId, apiName, endpoint, method = "GET", headers: extraHeaders = {}, body: proxyBody } = req.body as {
      projectId?: number;
      apiName: string;
      endpoint: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };

    if (!apiName || !endpoint) {
      res.status(400).json({ error: "apiName et endpoint requis" });
      return;
    }

    // Look up stored integration key
    const integration = await getIntegrationKey(user.id, apiName, projectId);
    if (!integration) {
      res.status(404).json({ error: `Aucune clé API trouvée pour "${apiName}". Ajoutez-la depuis l'éditeur.` });
      return;
    }

    // Build target URL — use stored baseUrl or the endpoint as-is if it's a full URL
    let targetUrl: string;
    try {
      new URL(endpoint); // throws if not a full URL
      targetUrl = endpoint;
    } catch {
      const base = integration.baseUrl?.replace(/\/$/, "") || "";
      targetUrl = base + (endpoint.startsWith("/") ? endpoint : "/" + endpoint);
    }

    // Security: block SSRF to internal addresses
    const blocked = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i;
    if (blocked.test(targetUrl)) {
      res.status(403).json({ error: "Cible non autorisée" });
      return;
    }

    try {
      pipelineLog("proxy:call", { apiName, endpoint: targetUrl, method, userId: user.id });

      const fetchRes = await fetch(targetUrl, {
        method,
        headers: {
          "Authorization": `Bearer ${integration.key}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: proxyBody && method !== "GET" && method !== "HEAD"
          ? JSON.stringify(proxyBody)
          : undefined,
      });

      const contentType = fetchRes.headers.get("content-type") || "application/json";
      const raw = await fetchRes.text();

      res.status(fetchRes.status)
        .header("Content-Type", contentType)
        .send(raw);
    } catch (err: any) {
      res.status(502).json({ error: `Proxy error: ${err.message}` });
    }
  });

  // ── POST /api/integrations/search-doc ──────────────────────────────────────
  // Given an API name, ask the LLM to return a brief integration guide +
  // the official base URL — used to pre-fill the docSummary when saving a key.
  app.post("/api/integrations/search-doc", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { apiName } = req.body as { apiName: string };
    if (!apiName) { res.status(400).json({ error: "apiName requis" }); return; }

    // Use the best available LLM to describe the API
    const [claudeKey, openaiKey, deepseekKey] = await Promise.all([
      getPlatformKey("anthropic"),
      getPlatformKey("openai"),
      getPlatformKey("deepseek"),
    ]);
    const llmKey = claudeKey || openaiKey || deepseekKey;
    if (!llmKey) { res.status(400).json({ error: "Aucune clé LLM disponible" }); return; }

    const provider = claudeKey ? "anthropic" : openaiKey ? "openai" : "deepseek";
    const model = claudeKey ? "claude-haiku-4-5" : openaiKey ? "gpt-4o-mini" : "deepseek-chat";

    const prompt = `Tu es un expert en intégrations API. Pour l'API "${apiName}", réponds UNIQUEMENT avec ce JSON (sans markdown) :
{
  "label": "Nom officiel de l'API",
  "baseUrl": "https://api.example.com/v1",
  "docUrl": "https://docs.example.com",
  "authType": "Bearer|ApiKey|Basic|OAuth2",
  "keyHeader": "Authorization",
  "summary": "Description courte en 2 phrases de ce que fait cette API et comment l'authentification fonctionne.",
  "exampleEndpoint": "/endpoint-le-plus-commun",
  "exampleMethod": "GET"
}`;

    try {
      let result = "";
      if (provider === "anthropic") {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": llmKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
        });
        const d = await r.json() as any;
        result = d.content?.[0]?.text || "{}";
      } else {
        const baseUrl = provider === "deepseek" ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1";
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${llmKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
        });
        const d = await r.json() as any;
        result = d.choices?.[0]?.message?.content || "{}";
      }

      const clean = result.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
      const info = JSON.parse(clean);
      res.json(info);
    } catch {
      res.json({ label: apiName, baseUrl: null, docUrl: null, summary: "API inconnue.", exampleEndpoint: "/", exampleMethod: "GET" });
    }
  });
}
