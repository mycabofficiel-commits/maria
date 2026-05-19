CREATE TYPE "public"."api_key_status" AS ENUM('valid', 'invalid', 'expired', 'quota_exceeded', 'untested');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."collaborator_role" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."collaborator_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."framework" AS ENUM('html', 'react', 'nextjs');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'creator', 'pro', 'agency');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'generating', 'ready', 'published', 'archived', 'error');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin', 'ultra');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('success', 'error');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('generating', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"provider" varchar(32) DEFAULT 'anthropic' NOT NULL,
	"encryptedKey" text NOT NULL,
	"keyHint" varchar(16),
	"model" varchar(64) DEFAULT 'claude-3-5-sonnet-20241022' NOT NULL,
	"status" "api_key_status" DEFAULT 'untested' NOT NULL,
	"lastTestedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"versionId" integer,
	"tokensUsed" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"slug" varchar(32) NOT NULL,
	"priceMonthlyEur" integer DEFAULT 0 NOT NULL,
	"projectsLimit" integer DEFAULT 1 NOT NULL,
	"generationsLimit" integer DEFAULT 3 NOT NULL,
	"features" jsonb,
	"stripePriceId" varchar(128),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plans_name_unique" UNIQUE("name"),
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"ownerId" integer NOT NULL,
	"collaboratorId" integer,
	"inviteEmail" varchar(320),
	"inviteToken" varchar(128) NOT NULL,
	"role" "collaborator_role" DEFAULT 'viewer' NOT NULL,
	"status" "collaborator_status" DEFAULT 'pending' NOT NULL,
	"acceptedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_collaborators_inviteToken_unique" UNIQUE("inviteToken")
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"versionId" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"fileType" varchar(32),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"siteType" varchar(64),
	"style" varchar(64),
	"language" varchar(8) DEFAULT 'fr',
	"colorPalette" varchar(64),
	"framework" "framework" DEFAULT 'html' NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"currentVersionId" integer,
	"previewUrl" text,
	"customDomain" varchar(255),
	"metaTitle" varchar(255),
	"metaDescription" text,
	"ogImage" text,
	"favicon" text,
	"isPublished" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp,
	"deployedUrl" text,
	"deployedAt" timestamp,
	"deployedVersionId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer,
	"action" varchar(64) NOT NULL,
	"model" varchar(64),
	"tokensUsed" integer DEFAULT 0,
	"costEstimateUsd" bigint DEFAULT 0,
	"durationMs" integer,
	"status" "usage_status" DEFAULT 'success' NOT NULL,
	"errorMessage" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"avatarUrl" text,
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"onboardingDone" boolean DEFAULT false NOT NULL,
	"stripeCustomerId" varchar(128),
	"stripeSubscriptionId" varchar(128),
	"subscriptionStatus" varchar(64),
	"currentPeriodEnd" timestamp,
	"generationsUsed" integer DEFAULT 0 NOT NULL,
	"generationsLimit" integer DEFAULT 3 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer NOT NULL,
	"versionNumber" integer DEFAULT 1 NOT NULL,
	"label" varchar(128),
	"prompt" text,
	"generatedCode" text,
	"files" jsonb,
	"tokensUsed" integer DEFAULT 0,
	"generationTimeMs" integer,
	"model" varchar(64),
	"status" "version_status" DEFAULT 'ready' NOT NULL,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
