CREATE TABLE `project_collaborators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`ownerId` int NOT NULL,
	`collaboratorId` int,
	`inviteEmail` varchar(320),
	`inviteToken` varchar(128) NOT NULL,
	`role` enum('viewer','editor') NOT NULL DEFAULT 'viewer',
	`status` enum('pending','accepted','revoked') NOT NULL DEFAULT 'pending',
	`acceptedAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_collaborators_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_collaborators_inviteToken_unique` UNIQUE(`inviteToken`)
);
