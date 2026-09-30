CREATE TABLE `caseEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseId` int NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`note` text NOT NULL,
	`actorId` int NOT NULL,
	`actorName` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `caseEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseNumber` varchar(32) NOT NULL,
	`year` int NOT NULL,
	`province` varchar(64) NOT NULL,
	`dateReceived` timestamp NOT NULL,
	`teacherName` varchar(160) NOT NULL,
	`employeeReference` varchar(80),
	`matterType` enum('Appointment','Industrial & General','Legal') NOT NULL,
	`matterSummary` text NOT NULL,
	`assignedOfficerId` int,
	`assignedOfficerName` varchar(160),
	`sectionReferred` varchar(120),
	`dateReferred` timestamp,
	`status` enum('NEW','VER','INV','REF','ADV','DEC','LEG','ACT','RES','CLS','ESC') NOT NULL DEFAULT 'NEW',
	`actionRequired` text,
	`dueDate` timestamp,
	`outcome` text,
	`dateClosed` timestamp,
	`priority` enum('normal','urgent') NOT NULL DEFAULT 'normal',
	`createdById` int NOT NULL,
	`createdByName` varchar(160),
	`receivedByName` varchar(160),
	`processedByName` varchar(160),
	`decidedByName` varchar(160),
	`communicatedByName` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cases_id` PRIMARY KEY(`id`),
	CONSTRAINT `cases_caseNumber_unique` UNIQUE(`caseNumber`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`caseId` int NOT NULL,
	`destination` varchar(120) NOT NULL,
	`reason` text NOT NULL,
	`referredAt` timestamp NOT NULL DEFAULT (now()),
	`responseDueDate` timestamp,
	`responseReceivedAt` timestamp,
	`responseSummary` text,
	`status` enum('pending','received','overdue') NOT NULL DEFAULT 'pending',
	`referredById` int NOT NULL,
	`referredByName` varchar(160),
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','staff','commissioner','admin') NOT NULL DEFAULT 'staff',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
