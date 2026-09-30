import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/** Core user table backing the Manus authentication flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /**
   * The name an officer types at sign-in. Unique, and separate from the email so
   * a username does not have to be an email address - the Commission issues
   * employee references, and a person should not have to remember which of
   * their addresses this system knows them by.
   *
   * Nullable: an account created by the identity provider on first sign-in has
   * never picked one, and the provider remains its way in.
   */
  username: varchar("username", { length: 64 }).unique(),
  /**
   * Local credential for the username-and-password sign-in. Null means the
   * account signs in through the identity provider only, which is the normal
   * production path - this exists so the platform can be exercised and
   * demonstrated without one. See server/_core/localAuth.ts.
   */
  passwordHash: varchar("passwordHash", { length: 255 }),
  // No teacher tier: the manual routes every matter through the Provincial
  // Matters office, so a teacher never signs in. See ROLE_VALUES in
  // shared/roles.ts for the reasoning.
  // `assistant` is the Professional Assistant to the Director (§12), the role
  // that maintains and monitors the central register. See ROLE_VALUES in
  // shared/roles.ts.
  role: mysqlEnum("role", [
    "staff",
    "assistant",
    "commissioner",
    "admin",
    "super_admin",
  ])
    .default("staff")
    .notNull(),
  /**
   * Storage key for the officer's uploaded profile image, or null. Same S3
   * object store the case file uses, so the image is served from
   * /manus-storage/{avatarKey} like every other document. Null means the account
   * has never uploaded one and the interface shows the initial.
   */
  avatarKey: varchar("avatarKey", { length: 255 }),
  // Deactivated accounts keep their history but can no longer sign in.
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const caseStatusValues = [
  "NEW",
  "VER",
  "INV",
  "REF",
  "ADV",
  "DEC",
  "LEG",
  "ACT",
  "RES",
  "CLS",
  "ESC",
] as const;

// The matter classifications live in shared/matters.ts and are imported rather
// than restated, so the enum the database stores and the list the interface
// offers cannot drift apart. Re-exported so existing `@shared/types` importers
// keep resolving them from the schema as they always have.
import {
  matterTypeValues,
  provinceValues,
} from "../shared/matters";
export { matterTypeValues, provinceValues };

export const cases = mysqlTable("cases", {
  id: int("id").autoincrement().primaryKey(),
  caseNumber: varchar("caseNumber", { length: 32 }).notNull().unique(),
  year: int("year").notNull(),
  province: varchar("province", { length: 64 }).notNull(),
  dateReceived: timestamp("dateReceived").notNull(),
  teacherName: varchar("teacherName", { length: 160 }).notNull(),
  employeeReference: varchar("employeeReference", { length: 80 }),
  matterType: mysqlEnum("matterType", matterTypeValues).notNull(),
  matterSummary: text("matterSummary").notNull(),
  assignedOfficerId: int("assignedOfficerId"),
  assignedOfficerName: varchar("assignedOfficerName", { length: 160 }),
  sectionReferred: varchar("sectionReferred", { length: 120 }),
  dateReferred: timestamp("dateReferred"),
  status: mysqlEnum("status", caseStatusValues).default("NEW").notNull(),
  actionRequired: text("actionRequired"),
  dueDate: timestamp("dueDate"),
  outcome: text("outcome"),
  dateClosed: timestamp("dateClosed"),
  priority: mysqlEnum("priority", ["normal", "urgent"])
    .default("normal")
    .notNull(),
  // §14 escalation ladder: 0 = officer, 6 = Legal Section / Commission.
  escalationLevel: int("escalationLevel").default(0).notNull(),
  // §12C case brief prepared before a matter is presented to the Director.
  briefIssue: text("briefIssue"),
  briefBackground: text("briefBackground"),
  briefActionTaken: text("briefActionTaken"),
  briefCurrentPosition: text("briefCurrentPosition"),
  briefIssueRequiringDecision: text("briefIssueRequiringDecision"),
  briefRecommendation: text("briefRecommendation"),
  briefPreparedByName: varchar("briefPreparedByName", { length: 160 }),
  briefPreparedAt: timestamp("briefPreparedAt"),
  // §13F surfaced to the Director as needing a decision.
  decisionRequired: boolean("decisionRequired").default(false).notNull(),
  // §15 the officer who referred the matter, mirrored for register display.
  referredByName: varchar("referredByName", { length: 160 }),
  dateReferredAt: timestamp("dateReferredAt"),
  createdById: int("createdById").notNull(),
  createdByName: varchar("createdByName", { length: 160 }),
  receivedByName: varchar("receivedByName", { length: 160 }),
  processedByName: varchar("processedByName", { length: 160 }),
  decidedByName: varchar("decidedByName", { length: 160 }),
  communicatedByName: varchar("communicatedByName", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
    // The register list. Every page of the case register sorts on updatedAt and
    // most visits filter to one status, so status leads and updatedAt follows -
    // that lets the filter and the sort share one index rather than the server
    // sorting rows it has already read.
    index("cases_status_updatedAt_idx").on(table.status, table.updatedAt),
    // Officer load and "matters I created", both counted on the admin page.
    index("cases_assignedOfficerId_idx").on(table.assignedOfficerId),
    index("cases_createdById_idx").on(table.createdById),
    // §13F: the Director's queue of matters needing a decision, and the
    // dashboard's decision-required figure.
    index("cases_decisionRequired_idx").on(table.decisionRequired),
    // The province filter and the per-province reporting breakdowns.
    index("cases_province_idx").on(table.province),
  ]);

export const caseEvents = mysqlTable("caseEvents", {
  id: int("id").autoincrement().primaryKey(),
  caseId: int("caseId").notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  note: text("note").notNull(),
  actorId: int("actorId").notNull(),
  actorName: varchar("actorName", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
    // The single most important index in the schema, and the one that was
    // missing. Opening a matter reads its whole timeline newest-first; without
    // this the server scans every event ever written across every matter to
    // return one matter's history. caseId leads and createdAt follows because
    // the timeline is always ordered, and the pair lets the server walk the
    // index and stop rather than reading rows and sorting them.
    index("caseEvents_caseId_createdAt_idx").on(table.caseId, table.createdAt),
    // "Matters this officer has acted on" - counted when an account is
    // deactivated, and the filter behind the audit trail.
    index("caseEvents_actorId_idx").on(table.actorId),
    // The global audit trail, newest first, across all matters.
    index("caseEvents_createdAt_idx").on(table.createdAt),
  ]);

export const referrals = mysqlTable("referrals", {
  id: int("id").autoincrement().primaryKey(),
  caseId: int("caseId").notNull(),
  destination: varchar("destination", { length: 120 }).notNull(),
  reason: text("reason").notNull(),
  // §5 which triggers applied, comma separated keys from REFERRAL_CRITERIA.
  criteria: text("criteria"),
  // §6 a legal referral takes the Legal Section path; officers give no opinion.
  isLegal: boolean("isLegal").default(false).notNull(),
  // §6 the Director is notified before a legal matter leaves the province.
  directorNotifiedName: varchar("directorNotifiedName", { length: 160 }),
  directorNotifiedAt: timestamp("directorNotifiedAt"),
  referredAt: timestamp("referredAt").defaultNow().notNull(),
  responseDueDate: timestamp("responseDueDate"),
  responseReceivedAt: timestamp("responseReceivedAt"),
  responseSummary: text("responseSummary"),
  // §8 required statement set for Industrial and General referrals.
  statementClaim: text("statementClaim"),
  statementVerified: text("statementVerified"),
  statementUnresolved: text("statementUnresolved"),
  statementAdviceRequired: text("statementAdviceRequired"),
  status: mysqlEnum("status", ["pending", "received", "overdue"])
    .default("pending")
    .notNull(),
  referredById: int("referredById").notNull(),
  referredByName: varchar("referredByName", { length: 160 }),
}, (table) => [
  // A matter's referral history, newest first, and "referrals this officer
  // made" - both counted on the admin page before an account is deactivated.
  index("referrals_caseId_referredAt_idx").on(table.caseId, table.referredAt),
  index("referrals_referredById_idx").on(table.referredById),
  // §12D follow-up: every referral still awaiting a National Section's
  // response, which is the Assistant's standing daily worklist.
  index("referrals_status_responseDueDate_idx").on(
    table.status,
    table.responseDueDate
  ),
]);

/**
 * §11 File Management. "Each matter should have a complete case file
 * containing:" - eleven classes of document. The class drives the closure
 * checklist rather than a free-text attachment list.
 */
export const caseDocuments = mysqlTable("caseDocuments", {
  id: int("id").autoincrement().primaryKey(),
  caseId: int("caseId").notNull(),
  documentClass: varchar("documentClass", { length: 64 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  // Storage key for the uploaded object, or null for a logged-only entry.
  fileKey: varchar("fileKey", { length: 255 }),
  fileName: varchar("fileName", { length: 200 }),
  fileSize: int("fileSize"),
  mimeType: varchar("mimeType", { length: 120 }),
  note: text("note"),
  loggedById: int("loggedById").notNull(),
  loggedByName: varchar("loggedByName", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  // The §11 case file, read in one go whenever a matter is opened.
  index("caseDocuments_caseId_idx").on(table.caseId),
  // Counted on the admin page before an account is deactivated, and the §11
  // closure checklist, which asks what class of document is still missing.
  index("caseDocuments_loggedById_idx").on(table.loggedById),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Case = typeof cases.$inferSelect;
export type InsertCase = typeof cases.$inferInsert;
export type CaseEvent = typeof caseEvents.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type CaseDocument = typeof caseDocuments.$inferSelect;
