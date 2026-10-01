CREATE TYPE "public"."case_priority" AS ENUM('normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('NEW', 'VER', 'INV', 'ADV', 'REF', 'DEC', 'LEG', 'ACT', 'RES', 'CLS', 'ESC');--> statement-breakpoint
CREATE TYPE "public"."matter_type" AS ENUM('Appointment', 'Industrial & General', 'Legal');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'received', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('staff', 'assistant', 'commissioner', 'admin', 'super_admin');--> statement-breakpoint
CREATE TABLE "caseDocuments" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"documentClass" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"fileKey" varchar(255),
	"fileName" varchar(200),
	"fileSize" integer,
	"mimeType" varchar(120),
	"note" text,
	"loggedById" integer NOT NULL,
	"loggedByName" varchar(160),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caseEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"eventType" varchar(64) NOT NULL,
	"note" text NOT NULL,
	"actorId" integer NOT NULL,
	"actorName" varchar(160),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseNumber" varchar(32) NOT NULL,
	"year" integer NOT NULL,
	"province" varchar(64) NOT NULL,
	"dateReceived" timestamp NOT NULL,
	"teacherName" varchar(160) NOT NULL,
	"employeeReference" varchar(80),
	"matterType" "matter_type" NOT NULL,
	"matterSummary" text NOT NULL,
	"assignedOfficerId" integer,
	"assignedOfficerName" varchar(160),
	"sectionReferred" varchar(120),
	"dateReferred" timestamp,
	"status" "case_status" DEFAULT 'NEW' NOT NULL,
	"actionRequired" text,
	"dueDate" timestamp,
	"outcome" text,
	"dateClosed" timestamp,
	"priority" "case_priority" DEFAULT 'normal' NOT NULL,
	"escalationLevel" integer DEFAULT 0 NOT NULL,
	"briefIssue" text,
	"briefBackground" text,
	"briefActionTaken" text,
	"briefCurrentPosition" text,
	"briefIssueRequiringDecision" text,
	"briefRecommendation" text,
	"briefPreparedByName" varchar(160),
	"briefPreparedAt" timestamp,
	"decisionRequired" boolean DEFAULT false NOT NULL,
	"referredByName" varchar(160),
	"dateReferredAt" timestamp,
	"createdById" integer NOT NULL,
	"createdByName" varchar(160),
	"receivedByName" varchar(160),
	"processedByName" varchar(160),
	"decidedByName" varchar(160),
	"communicatedByName" varchar(160),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cases_caseNumber_unique" UNIQUE("caseNumber")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"destination" varchar(120) NOT NULL,
	"reason" text NOT NULL,
	"criteria" text,
	"isLegal" boolean DEFAULT false NOT NULL,
	"directorNotifiedName" varchar(160),
	"directorNotifiedAt" timestamp,
	"referredAt" timestamp DEFAULT now() NOT NULL,
	"responseDueDate" timestamp,
	"responseReceivedAt" timestamp,
	"responseSummary" text,
	"statementClaim" text,
	"statementVerified" text,
	"statementUnresolved" text,
	"statementAdviceRequired" text,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"referredById" integer NOT NULL,
	"referredByName" varchar(160)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"username" varchar(64),
	"passwordHash" varchar(255),
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"avatarKey" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE INDEX "caseDocuments_caseId_idx" ON "caseDocuments" USING btree ("caseId");--> statement-breakpoint
CREATE INDEX "caseDocuments_loggedById_idx" ON "caseDocuments" USING btree ("loggedById");--> statement-breakpoint
CREATE INDEX "caseEvents_caseId_createdAt_idx" ON "caseEvents" USING btree ("caseId","createdAt");--> statement-breakpoint
CREATE INDEX "caseEvents_actorId_idx" ON "caseEvents" USING btree ("actorId");--> statement-breakpoint
CREATE INDEX "caseEvents_createdAt_idx" ON "caseEvents" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "cases_status_updatedAt_idx" ON "cases" USING btree ("status","updatedAt");--> statement-breakpoint
CREATE INDEX "cases_assignedOfficerId_idx" ON "cases" USING btree ("assignedOfficerId");--> statement-breakpoint
CREATE INDEX "cases_createdById_idx" ON "cases" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "cases_decisionRequired_idx" ON "cases" USING btree ("decisionRequired");--> statement-breakpoint
CREATE INDEX "cases_province_idx" ON "cases" USING btree ("province");--> statement-breakpoint
CREATE INDEX "referrals_caseId_referredAt_idx" ON "referrals" USING btree ("caseId","referredAt");--> statement-breakpoint
CREATE INDEX "referrals_referredById_idx" ON "referrals" USING btree ("referredById");--> statement-breakpoint
CREATE INDEX "referrals_status_responseDueDate_idx" ON "referrals" USING btree ("status","responseDueDate");