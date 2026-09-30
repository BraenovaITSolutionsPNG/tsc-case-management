CREATE TABLE `caseDocuments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseId` int NOT NULL,
	`documentClass` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`fileKey` varchar(255),
	`fileName` varchar(200),
	`fileSize` int,
	`mimeType` varchar(120),
	`note` text,
	`loggedById` int NOT NULL,
	`loggedByName` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `caseDocuments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cases` ADD `escalationLevel` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefIssue` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefBackground` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefActionTaken` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefCurrentPosition` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefIssueRequiringDecision` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefRecommendation` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `briefPreparedByName` varchar(160);--> statement-breakpoint
ALTER TABLE `cases` ADD `briefPreparedAt` timestamp;--> statement-breakpoint
ALTER TABLE `cases` ADD `decisionRequired` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cases` ADD `referredByName` varchar(160);--> statement-breakpoint
ALTER TABLE `cases` ADD `dateReferredAt` timestamp;--> statement-breakpoint
ALTER TABLE `referrals` ADD `criteria` text;--> statement-breakpoint
ALTER TABLE `referrals` ADD `isLegal` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `referrals` ADD `directorNotifiedName` varchar(160);--> statement-breakpoint
ALTER TABLE `referrals` ADD `directorNotifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `referrals` ADD `statementClaim` text;--> statement-breakpoint
ALTER TABLE `referrals` ADD `statementVerified` text;--> statement-breakpoint
ALTER TABLE `referrals` ADD `statementUnresolved` text;--> statement-breakpoint
ALTER TABLE `referrals` ADD `statementAdviceRequired` text;