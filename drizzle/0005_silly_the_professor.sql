CREATE TABLE `caseParties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('teacher','officer','referrer','decider') NOT NULL DEFAULT 'teacher',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `caseParties_id` PRIMARY KEY(`id`),
	CONSTRAINT `caseId` UNIQUE(`caseId`,`userId`,`role`)
);
--> statement-breakpoint
CREATE INDEX `caseParties_caseId` ON `caseParties` (`caseId`);--> statement-breakpoint
CREATE INDEX `caseParties_userId` ON `caseParties` (`userId`);