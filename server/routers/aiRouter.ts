/**
 * Multi-AI Router — Maria
 * Supporte : Anthropic (Claude), DeepSeek, OpenAI, Mistral, Groq
 * Compatible avec le système BYOK (Bring Your Own Key) existant
 */

export type AIProvider = "anthropic" | "deepseek" | "openai" | "mistral" | "groq";

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  contextWindow: number;
  costPer1kTokens: number; // en USD
  strengths: string[];
}

export const AI_MODELS: AIModel[] = [
  // Anthropic
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    costPer1kTokens: 0.003,
    strengths: ["Code", "Raisonnement", "Instructions complexes"],
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    costPer1kTokens: 0.015,
    strengths: ["Tâches complexes", "Analyse approfondie"],
  },
  // DeepSeek
  {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    contextWindow: 128000,
    costPer1kTokens: 0.00027,
    strengths: ["Code", "Rapide", "Très économique"],
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek R1",
    provider: "deepseek",
    contextWindow: 128000,
    costPer1kTokens: 0.00055,
    strengths: ["Raisonnement", "Maths", "Logique"],
  },
  // OpenAI
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    costPer1kTokens: 0.005,
    strengths: ["Polyvalent", "Vision", "Function calling"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    contextWindow: 128000,
    costPer1kTokens: 0.00015,
    strengths: ["Rapide", "Économique", "Tâches simples"],
  },
  // Mistral
  {
    id: "mistral-large-latest",
    name: "Mistral Large",
    provider: "mistral",
    contextWindow: 128000,
    costPer1kTokens: 0.002,
    strengths: ["Européen", "Multilingue", "Code"],
  },
  // Groq
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B (Groq)",
    provider: "groq",
    contextWindow: 128000,
    costPer1kTokens: 0.00059,
    strengths: ["Ultra rapide", "Open source", "Économique"],
  },
];

// ─── API Endpoints par provider ──────────────────────────────────────────────

const PROVIDER_CONFIG: Record<AIProvider, { baseUrl: string; authHeader: string }> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    authHeader: "x-api-key",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    authHeader: "Authorization", // Bearer token
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    authHeader: "Authorization", // Bearer token
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    authHeader: "Authorization",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    authHeader: "Authorization",
  },
};

// ─── Generate via any provider ───────────────────────────────────────────────

export interface GenerateOptions {
  provider: AIProvider;
  model: string;
  apiKey: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  stream?: boolean;
}

export async function generateWithProvider(options: GenerateOptions): Promise<Response> {
  const { provider, model, apiKey, messages, systemPrompt, maxTokens = 8192, stream = false } = options;

  const config = PROVIDER_CONFIG[provider];

  // Anthropic a une API différente des autres
  if (provider === "anthropic") {
    return fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages.filter((m) => m.role !== "system"),
        stream,
      }),
    });
  }

  // Tous les autres providers sont compatibles OpenAI
  const allMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: allMessages,
      max_tokens: maxTokens,
      stream,
    }),
  });
}

// ─── Parse response selon le provider ────────────────────────────────────────

export async function parseResponse(provider: AIProvider, response: Response): Promise<string> {
  const data = await response.json();

  if (provider === "anthropic") {
    return data.content?.[0]?.text || "";
  }

  // Compatible OpenAI (DeepSeek, Groq, Mistral, OpenAI)
  return data.choices?.[0]?.message?.content || "";
}

// ─── Fallback automatique ─────────────────────────────────────────────────────

export async function generateWithFallback(
  primaryOptions: GenerateOptions,
  fallbackOptions?: GenerateOptions
): Promise<string> {
  try {
    const res = await generateWithProvider(primaryOptions);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await parseResponse(primaryOptions.provider, res);
  } catch (err) {
    if (fallbackOptions) {
      console.warn(`[AI Router] Fallback to ${fallbackOptions.provider}`);
      const res = await generateWithProvider(fallbackOptions);
      return await parseResponse(fallbackOptions.provider, res);
    }
    throw err;
  }
}
