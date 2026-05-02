CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'anthropic',
	`encryptedKey` text NOT NULL,
	`keyHint` varchar(16),
	`model` varchar(64) NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
	`status` enum('valid','invalid','expired','quota_exceeded','untested') NOT NULL DEFAULT 'untested',
	`lastTestedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`versionId` int,
	`tokensUsed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`slug` varchar(32) NOT NULL,
	`priceMonthlyEur` int NOT NULL DEFAULT 0,
	`projectsLimit` int NOT NULL DEFAULT 1,
	`generationsLimit` int NOT NULL DEFAULT 3,
	`features` json,
	`stripePriceId` varchar(128),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_name_unique` UNIQUE(`name`),
	CONSTRAINT `plans_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`versionId` int NOT NULL,
	`filename` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`fileType` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`siteType` varchar(64),
	`style` varchar(64),
	`language` varchar(8) DEFAULT 'fr',
	`colorPalette` varchar(64),
	`framework` enum('html','react','nextjs') NOT NULL DEFAULT 'html',
	`status` enum('draft','generating','ready','published','archived','error') NOT NULL DEFAULT 'draft',
	`currentVersionId` int,
	`previewUrl` text,
	`customDomain` varchar(255),
	`metaTitle` varchar(255),
	`metaDescription` text,
	`ogImage` text,
	`favicon` text,
	`isPublished` boolean NOT NULL DEFAULT false,
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usage_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`action` varchar(64) NOT NULL,
	`model` varchar(64),
	`tokensUsed` int DEFAULT 0,
	`costEstimateUsd` bigint DEFAULT 0,
	`durationMs` int,
	`status` enum('success','error') NOT NULL DEFAULT 'success',
	`errorMessage` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usage_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`versionNumber` int NOT NULL DEFAULT 1,
	`label` varchar(128),
	`prompt` text,
	`generatedCode` text,
	`files` json,
	`tokensUsed` int DEFAULT 0,
	`generationTimeMs` int,
	`model` varchar(64),
	`status` enum('generating','ready','error') NOT NULL DEFAULT 'ready',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatarUrl` text;--> statement-breakpoint
ALTER TABLE `users` ADD `plan` enum('free','creator','pro','agency') DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingDone` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeCustomerId` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `stripeSubscriptionId` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionStatus` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `currentPeriodEnd` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `generationsUsed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `generationsLimit` int DEFAULT 3 NOT NULL;