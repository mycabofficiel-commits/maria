import {
  bigint,
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  avatarUrl: text("avatarUrl"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "ultra"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free", "creator", "pro", "agency"]).default("free").notNull(),
  onboardingDone: boolean("onboardingDone").default(false).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  subscriptionStatus: varchar("subscriptionStatus", { length: 64 }),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  generationsUsed: int("generationsUsed").default(0).notNull(),
  generationsLimit: int("generationsLimit").default(3).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 32 }).default("anthropic").notNull(),
  encryptedKey: text("encryptedKey").notNull(),
  keyHint: varchar("keyHint", { length: 16 }), // last 4 chars visible
  model: varchar("model", { length: 64 }).default("claude-3-5-sonnet-20241022").notNull(),
  status: mysqlEnum("status", ["valid", "invalid", "expired", "quota_exceeded", "untested"]).default("untested").notNull(),
  lastTestedAt: timestamp("lastTestedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── Projects ─────────────────────────────────────────────────────────────────
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  description: text("description"),
  siteType: varchar("siteType", { length: 64 }), // landing, vitrine, saas, restaurant…
  style: varchar("style", { length: 64 }), // luxe, moderne, minimaliste…
  language: varchar("language", { length: 8 }).default("fr"),
  colorPalette: varchar("colorPalette", { length: 64 }),
  framework: mysqlEnum("framework", ["html", "react", "nextjs"]).default("html").notNull(),
  status: mysqlEnum("status", ["draft", "generating", "ready", "published", "archived", "error"]).default("draft").notNull(),
  currentVersionId: int("currentVersionId"),
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
  deployedVersionId: int("deployedVersionId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ─── Versions ─────────────────────────────────────────────────────────────────
export const versions = mysqlTable("versions", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  versionNumber: int("versionNumber").notNull().default(1),
  label: varchar("label", { length: 128 }),
  prompt: text("prompt"),
  generatedCode: text("generatedCode"), // full HTML/CSS/JS
  files: json("files"), // { filename: content }
  tokensUsed: int("tokensUsed").default(0),
  generationTimeMs: int("generationTimeMs"),
  model: varchar("model", { length: 64 }),
  status: mysqlEnum("status", ["generating", "ready", "error"]).default("ready").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Version = typeof versions.$inferSelect;
export type InsertVersion = typeof versions.$inferInsert;

// ─── Chat Messages ────────────────────────────────────────────────────────────
export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  versionId: int("versionId"), // version created by this message (if assistant)
  tokensUsed: int("tokensUsed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

// ─── Project Files ────────────────────────────────────────────────────────────
export const projectFiles = mysqlTable("project_files", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  versionId: int("versionId").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  content: text("content").notNull(),
  fileType: varchar("fileType", { length: 32 }), // html, css, js, json…
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// ─── Usage Logs ───────────────────────────────────────────────────────────────
export const usageLogs = mysqlTable("usage_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  action: varchar("action", { length: 64 }).notNull(), // generate, edit, build, deploy
  model: varchar("model", { length: 64 }),
  tokensUsed: int("tokensUsed").default(0),
  costEstimateUsd: bigint("costEstimateUsd", { mode: "number" }).default(0), // in micro-cents
  durationMs: int("durationMs"),
  status: mysqlEnum("status", ["success", "error"]).default("success").notNull(),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UsageLog = typeof usageLogs.$inferSelect;
export type InsertUsageLog = typeof usageLogs.$inferInsert;

// ─── Project Collaborators ──────────────────────────────────────────────────
export const projectCollaborators = mysqlTable("project_collaborators", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  ownerId: int("ownerId").notNull(),       // user who owns the project
  collaboratorId: int("collaboratorId"),   // null until invite accepted
  inviteEmail: varchar("inviteEmail", { length: 320 }),
  inviteToken: varchar("inviteToken", { length: 128 }).notNull().unique(),
  role: mysqlEnum("role", ["viewer", "editor"]).default("viewer").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "revoked"]).default("pending").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectCollaborator = typeof projectCollaborators.$inferSelect;
export type InsertProjectCollaborator = typeof projectCollaborators.$inferInsert;

// ─── Plans ────────────────────────────────────────────────────────────────────
export const plans = mysqlTable("plans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  slug: varchar("slug", { length: 32 }).notNull().unique(),
  priceMonthlyEur: int("priceMonthlyEur").default(0).notNull(), // in cents
  projectsLimit: int("projectsLimit").default(1).notNull(),
  generationsLimit: int("generationsLimit").default(3).notNull(),
  features: json("features"),
  stripePriceId: varchar("stripePriceId", { length: 128 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type InsertPlan = typeof plans.$inferInsert;
