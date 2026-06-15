-- otp_codes : codes de vérification (inscription) et de réinitialisation (mot de passe)
-- persistés en DB pour survivre aux redéploiements Render et au multi-instance
-- (remplace les Map en mémoire de authRoutes.ts).
CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "openId" varchar(320) NOT NULL,
  "purpose" varchar(16) NOT NULL,
  "code" varchar(6) NOT NULL,
  "payload" jsonb,
  "attempts" integer NOT NULL DEFAULT 0,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Recherche par (openId, purpose) à chaque vérification
CREATE INDEX IF NOT EXISTS "otp_codes_openid_purpose_idx" ON "otp_codes" ("openId", "purpose");
