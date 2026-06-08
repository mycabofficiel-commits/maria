import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum("role", ["user", "admin", "ultra"]);
export const planEnum = pgEnum("plan", ["free", "creator", "pro", "agency"]);
export const frameworkEnum = pgEnum("framework", ["html", "react", "nextjs", "expo"]);
export const projectStatusEnum = pgEnum("project_status", ["draft", "generating", "ready", "published", "archived", "error"]);
export const versionStatusEnum = pgEnum("version_status", ["generating", "ready", "error"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["valid", "invalid", "expired", "quota_exceeded", "untested"]);
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);
export const collaboratorRoleEnum = pgEnum("collaborator_role", ["viewer", "editor"]);
export const collaboratorStatusEnum = pgEnum("collaborator_status", ["pending", "accepted", "revoked"]);
export const usageStatusEnum = pgEnum("usage_status", ["success", "error"]);

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  avatarUrl: text("avatarUrl"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  plan: planEnum("plan").default("free").notNull(),
  onboardingDone: boolean("onboardingDone").default(false).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  subscriptionStatus: varchar("subscriptionStatus", { length: 64 }),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  generationsUsed: integer("generationsUsed").default(0).notNull(),
  generationsLimit: integer("generationsLimit").default(3).notNull(),
  monthlyTokensLimit: integer("monthlyTokensLimit"),
  passwordHash: text("passwordHash"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  provider: varchar("provider", { length: 32 }).default("anthropic").notNull(),
  encryptedKey: text("encryptedKey").notNull(),
  keyHint: varchar("keyHint", { length: 16 }),
  model: varchar("model", { length: 64 }).default("claude-3-5-sonnet-20241022").notNull(),
  status: apiKeyStatusEnum("status").default("untested").notNull(),
  lastTestedAt: timestamp("lastTestedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── Projects ─────────────────────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  description: text("description"),
  siteType: varchar("siteType", { length: 64 }),
  style: varchar("style", { length: 64 }),
  language: varchar("language", { length: 8 }).default("fr"),
  colorPalette: varchar("colorPalette", { length: 64 }),
  framework: frameworkEnum("framework").default("html").notNull(),
  status: projectStatusEnum("status").default("draft").notNull(),
  currentVersionId: integer("currentVersionId"),
  previewUrl: text("previewUrl"),
  customDomain: varchar("customDomain", { length: 255 }),
  metaTitle: varchar("metaTitle", { length: 255 }),
  metaDescription: text("metaDescription"),
  ogImage: text("ogImage"),
  favicon: text("favicon"),
  isPublished: boolean("isPublished").default(false).notNull(),
  publishedAt: timestamp("publishedAt"),
  deployedUrl: text("deployedUrl"),
  deployedAt: timestamp("deployedAt"),
  deployedVersionId: integer("deployedVersionId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ─── Versions ─────────────────────────────────────────────────────────────────
export const versions = pgTable("versions", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  userId: integer("userId").notNull(),
  versionNumber: integer("versionNumber").notNull().default(1),
  label: varchar("label", { length: 128 }),
  prompt: text("prompt"),
  generatedCode: text("generatedCode"),
  files: jsonb("files"),
  tokensUsed: integer("tokensUsed").default(0),
  generationTimeMs: integer("generationTimeMs"),
  model: varchar("model", { length: 64 }),
  status: versionStatusEnum("status").default("ready").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Version = typeof versions.$inferSelect;
export type InsertVersion = typeof versions.$inferInsert;

// ─── Chat Messages ────────────────────────────────────────────────────────────
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  userId: integer("userId").notNull(),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  versionId: integer("versionId"),
  tokensUsed: integer("tokensUsed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

// ─── Project Files ────────────────────────────────────────────────────────────
export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  versionId: integer("versionId").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  content: text("content").notNull(),
  fileType: varchar("fileType", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// ─── Usage Logs ───────────────────────────────────────────────────────────────
export const usageLogs = pgTable("usage_logs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  projectId: integer("projectId"),
  action: varchar("action", { length: 64 }).notNull(),
  model: varchar("model", { length: 64 }),
  tokensUsed: integer("tokensUsed").default(0),
  costEstimateUsd: bigint("costEstimateUsd", { mode: "number" }).default(0),
  durationMs: integer("durationMs"),
  status: usageStatusEnum("status").default("success").notNull(),
  errorMessage: text("errorMessage"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UsageLog = typeof usageLogs.$inferSelect;
export type InsertUsageLog = typeof usageLogs.$inferInsert;

// ─── Project Collaborators ────────────────────────────────────────────────────
export const projectCollaborators = pgTable("project_collaborators", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  ownerId: integer("ownerId").notNull(),
  collaboratorId: integer("collaboratorId"),
  inviteEmail: varchar("inviteEmail", { length: 320 }),
  inviteToken: varchar("inviteToken", { length: 128 }).notNull().unique(),
  role: collaboratorRoleEnum("role").default("viewer").notNull(),
  status: collaboratorStatusEnum("status").default("pending").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectCollaborator = typeof projectCollaborators.$inferSelect;
export type InsertProjectCollaborator = typeof projectCollaborators.$inferInsert;

// ─── Platform API Keys (admin-managed LLM keys) ───────────────────────────────
export const platformApiKeys = pgTable("platform_api_keys", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 32 }).notNull().unique(),
  encryptedKey: text("encryptedKey").notNull(),
  keyHint: varchar("keyHint", { length: 16 }),
  label: varchar("label", { length: 64 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PlatformApiKey = typeof platformApiKeys.$inferSelect;
export type InsertPlatformApiKey = typeof platformApiKeys.$inferInsert;

// ─── User Integrations (third-party API keys stored per user/project) ────────
export const userIntegrations = pgTable("user_integrations", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  projectId: integer("projectId"),            // null = global, set = project-specific
  apiName: varchar("apiName", { length: 64 }).notNull(),   // "stripe", "openai", "twilio"…
  apiLabel: varchar("apiLabel", { length: 128 }).notNull(), // display name: "Stripe"
  encryptedKey: text("encryptedKey").notNull(),
  keyHint: varchar("keyHint", { length: 20 }), // "sk_live_****ab3c"
  baseUrl: varchar("baseUrl", { length: 512 }), // API base URL (for proxy routing)
  docUrl: text("docUrl"),                       // official doc URL found
  docSummary: text("docSummary"),               // brief doc summary for LLM context
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type UserIntegration = typeof userIntegrations.$inferSelect;
export type InsertUserIntegration = typeof userIntegrations.$inferInsert;

// ─── Plans ────────────────────────────────────────────────────────────────────
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  slug: varchar("slug", { length: 32 }).notNull().unique(),
  priceMonthlyEur: integer("priceMonthlyEur").default(0).notNull(),
  projectsLimit: integer("projectsLimit").default(1).notNull(),
  generationsLimit: integer("generationsLimit").default(3).notNull(),
  features: jsonb("features"),
  stripePriceId: varchar("stripePriceId", { length: 128 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type InsertPlan = typeof plans.$inferInsert;
