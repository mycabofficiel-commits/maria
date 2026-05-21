-- platform_api_keys: clés LLM gérées par l'admin (chiffrées en DB)
CREATE TABLE IF NOT EXISTS "platform_api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider" varchar(32) NOT NULL,
  "encryptedKey" text NOT NULL,
  "keyHint" varchar(16),
  "label" varchar(64),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "platform_api_keys_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
-- monthlyTokensLimit: limite mensuelle de tokens par utilisateur (null = illimité)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthlyTokensLimit" integer;
