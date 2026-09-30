CREATE INDEX `caseDocuments_caseId_idx` ON `caseDocuments` (`caseId`);--> statement-breakpoint
CREATE INDEX `caseDocuments_loggedById_idx` ON `caseDocuments` (`loggedById`);--> statement-breakpoint
CREATE INDEX `caseEvents_caseId_createdAt_idx` ON `caseEvents` (`caseId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `caseEvents_actorId_idx` ON `caseEvents` (`actorId`);--> statement-breakpoint
CREATE INDEX `caseEvents_createdAt_idx` ON `caseEvents` (`createdAt`);--> statement-breakpoint
CREATE INDEX `cases_status_updatedAt_idx` ON `cases` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `cases_assignedOfficerId_idx` ON `cases` (`assignedOfficerId`);--> statement-breakpoint
CREATE INDEX `cases_createdById_idx` ON `cases` (`createdById`);--> statement-breakpoint
CREATE INDEX `cases_decisionRequired_idx` ON `cases` (`decisionRequired`);--> statement-breakpoint
CREATE INDEX `cases_province_idx` ON `cases` (`province`);--> statement-breakpoint
CREATE INDEX `referrals_caseId_referredAt_idx` ON `referrals` (`caseId`,`referredAt`);--> statement-breakpoint
CREATE INDEX `referrals_referredById_idx` ON `referrals` (`referredById`);--> statement-breakpoint
CREATE INDEX `referrals_status_responseDueDate_idx` ON `referrals` (`status`,`responseDueDate`);