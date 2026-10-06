import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  lt,
  notInArray,
  or,
  sql,
  count,
} from "drizzle-orm";
import { CLOSED_STATUSES, isOpenStatus, isOverdue } from "../shared/statuses";
import { briefNeedsDecision } from "../shared/delegation";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  caseDocuments,
  caseEvents,
  cases,
  referrals,
  type Case,
  type InsertCase,
  users,
} from "../drizzle/schema";
import { describeTls, runtimeConnection } from "./_core/databaseConnection";

let _db: ReturnType<typeof drizzle> | null = null;
let _flavourChecked = false;

/**
 * The server we actually reached, once per process, and how the connection to it
 * is secured.
 *
 * This used to distinguish MariaDB from MySQL 8, which mattered because a schema
 * written for one and applied to the other fails in ways that surface much later
 * and read as something else entirely. PostgreSQL has no equivalent fork to
 * guess at — there is one dialect — so the version is reported rather than
 * classified. The TLS line is the same idea from the other end, because
 * "encrypted" and "not encrypted" are otherwise the same silence.
 */
async function logServerFlavour(db: NonNullable<ReturnType<typeof drizzle>>) {
  if (_flavourChecked) return;
  _flavourChecked = true;
  try {
    const result = await db.execute(sql`SELECT version() AS version`);
    // node-postgres hands back a QueryResult; the rows are on `.rows`. The MySQL
    // driver returned a bare array instead, which is why this is not one.
    const rows = (result as unknown as { rows: { version?: string }[] }).rows;
    const version = rows?.[0]?.version ?? "unknown";
    console.log(
      `[Database] Connected to PostgreSQL ${version} — ${describeTls()}`
    );
  } catch (error) {
    console.warn("[Database] Could not determine server version:", error);
  }
}

/**
 * Said once, loudly, and about the thing that is actually wrong.
 *
 * `getDb` used to return null in silence when DATABASE_URL was unset, and every
 * caller treats null as "nothing found" — so a deployment with no database
 * answered every sign-in attempt with "that username and password do not match
 * an account", and answered it for as long as the deployment existed. The
 * message was true of the credentials and useless about the cause.
 */
let reportedMissingUrl = false;

export async function getDb() {
  if (!_db && !process.env.DATABASE_URL && !reportedMissingUrl) {
    reportedMissingUrl = true;
    console.error(
      "[Database] DATABASE_URL is not set, so there is no database to read or write. Every screen that reads a matter and every sign-in will fail until it is. Set it on the deployment — not only locally."
    );
  }
  if (!_db && process.env.DATABASE_URL) {
    try {
      // The credentials as an object rather than as the URL itself, because the
      // TLS block a hosted database requires has nowhere to live in a URL.
      // `runtimeConnection` rather than `databaseCredentials`: this is the request
      // path, so it gets a pool sized for a serverless instance and a bounded
      // wait for a connection. drizzle-kit and the scripts keep the bare
      // credentials, which is what a migration wants.
      _db = drizzle({ connection: runtimeConnection() });
      await logServerFlavour(_db);
    } catch (error) {
      console.error("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/** Whether this process can reach a database at all. */
export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * The user behind a Supabase session. This row becomes `ctx.user`, which the
 * client reads through `auth.me`.
 *
 * There is no longer a stored credential to strip on the way out. That strip
 * existed because a raw select would have handed the password hash to the
 * browser on every request; Supabase holds the credential in `auth.users` and
 * never discloses it, so the column is gone and the hazard went with it. See
 * server/_core/supabaseSession.ts for the lookup's place in the request path.
 */
export async function getUserByAuthUserId(authUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.authUserId, authUserId))
    .limit(1);
  return result[0];
}

/**
 * Records that an officer was active just now.
 *
 * Split out of the session lookup because it is the one write on the
 * authentication path, and it is a write to an audit column rather than to the
 * identity. Doing it by primary key matters: an upsert here would resurrect a
 * row that had been deleted in between, on the strength of a cookie that is
 * still valid until it expires.
 */
export async function touchLastSignedIn(id: number, at: Date): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: at }).where(eq(users.id, id));
}

export type CaseListFilters = {
  search?: string;
  status?: string;
  matterType?: string;
  province?: string;
  overdueOnly?: boolean;
};

/**
 * The filter as SQL, in one place.
 *
 * Both the whole-register read and the paginated one go through here, so the two
 * cannot disagree about what a filter means. That matters more than it looks:
 * the register asks for a page of rows and a total, and if the total were
 * counted under different rules than the rows were selected under, a filtered
 * register would show "page 1 of 3" above one page of results.
 *
 * `overdueOnly` was previously applied in JavaScript after the rows came back,
 * which cannot be counted or paged at all. It is a straightforward predicate —
 * a due date in the past, on a matter that has not been finished — so it is
 * stated here against the same `CLOSED_STATUSES` the rest of the app uses, and
 * the server now does the work rather than shipping the province to do it.
 */
function caseConditions(filters: CaseListFilters) {
  const conditions = [];

  if (filters.search) {
    // Both the reference and the teacher's name, because that is what the search
    // box on the register offers: an officer looking for "the Kava matter" and
    // an officer looking for a reference are looking for the same row.
    // `ilike`, not `like`: the search box has always been case-insensitive, and
    // it was case-insensitive for a database reason rather than an application
    // one. MySQL's utf8mb4_unicode_ci collation made LIKE fold case on these
    // columns for free, and PostgreSQL's LIKE is case-sensitive, so porting the
    // query unchanged would silently narrow the search: an officer typing
    // "kava" would stop finding the Kava matter.
    conditions.push(
      or(
        ilike(cases.caseNumber, `%${filters.search}%`),
        ilike(cases.teacherName, `%${filters.search}%`)
      )
    );
  }
  if (filters.status)
    conditions.push(
      eq(
        cases.status,
        filters.status as (typeof cases.status.enumValues)[number]
      )
    );
  if (filters.matterType)
    conditions.push(
      eq(
        cases.matterType,
        filters.matterType as (typeof cases.matterType.enumValues)[number]
      )
    );
  if (filters.province) conditions.push(eq(cases.province, filters.province));
  if (filters.overdueOnly) {
    conditions.push(
      isNotNull(cases.dueDate),
      lt(cases.dueDate, new Date()),
      notInArray(cases.status, [...CLOSED_STATUSES])
    );
  }

  return conditions;
}

/**
 * Every matter in the provincial register. There is no per-account narrowing:
 * the manual places the whole register in front of every role that has an
 * account, and §15 requires the Director to see who received, processed,
 * referred, decided and communicated on every matter.
 *
 * This is the unpaginated read, kept for the aggregations — the dashboard, the
 * weekly brief, the quarterly and compliance reports — which need every row to
 * count over. The register itself uses `listCasesPage`.
 */
export async function listCases(filters: CaseListFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = caseConditions(filters);
  return db
    .select()
    .from(cases)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(cases.updatedAt));
}

/**
 * One page of the register, and how many matters the filter matched in total.
 *
 * The total is counted rather than derived from the page, because a register that
 * has been paged can no longer tell how many it holds. It is counted under the
 * same `caseConditions` the rows are selected under, so the two cannot disagree.
 *
 * Ordering is by when the matter was last touched rather than by its reference,
 * which is what makes the register usable while it is being worked: the matter
 * somebody has just acted on moves to the top. It is also why a page boundary
 * can move under the officer, and the one thing that makes it stable is that
 * `updatedAt` is written on every change to the matter.
 */
export async function listCasesPage(
  filters: CaseListFilters = {},
  page: { limit: number; offset: number } = { limit: 25, offset: 0 }
): Promise<{ rows: (typeof cases.$inferSelect)[]; total: number }> {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const where = caseConditions(filters);
  const predicate = where.length ? and(...where) : undefined;

  const [rows, counted] = await Promise.all([
    db
      .select()
      .from(cases)
      .where(predicate)
      .orderBy(desc(cases.updatedAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(cases).where(predicate),
  ]);

  return { rows, total: Number(counted[0]?.value ?? 0) };
}

/**
 * The figures across the whole register, not the filtered page.
 *
 * The register answers two different questions and used to answer both with the
 * same list. The table shows what the officer filtered to; the figures above it
 * answer "how is the province doing", which is why they are counted over every
 * matter. A register showing zero overdue matters while the filter happens to
 * hide an overdue province is misleading, and the filter chips already say which
 * filters are applied.
 *
 * Counting happens in the database rather than in the browser, which is the whole
 * point of the register being paged: these five numbers used to be produced by
 * receiving every matter in the province and counting them there. They now cost
 * one aggregate pass, whatever the register holds.
 *
 * The rules are the shared ones, restated as SQL because that is what a count
 * has to be. `open`, `overdue` and `unassigned` all turn on the same
 * `CLOSED_STATUSES` the rest of the app reads, so a status added there moves all
 * three together; `withoutAction` is the Golden Rule's own test, an open matter
 * with no action recorded against it.
 */
export async function summariseCases() {
  const db = await getDb();
  if (!db) {
    return { total: 0, open: 0, overdue: 0, unassigned: 0, withoutAction: 0 };
  }

  // One fragment, reused by all four conditional counts, so "not finished" is
  // spelled the same way every time it appears.
  const stillOpen = sql`${cases.status} not in (${sql.join(
    CLOSED_STATUSES.map(status => sql`${status}`),
    sql`, `
  )})`;
  const now = new Date();

  const [row] = await db
    .select({
      total: count(),
      open: sql<number>`sum(case when ${stillOpen} then 1 else 0 end)`,
      overdue: sql<number>`sum(case when ${cases.dueDate} is not null and ${cases.dueDate} < ${now} and ${stillOpen} then 1 else 0 end)`,
      unassigned: sql<number>`sum(case when (${cases.assignedOfficerName} is null or ${cases.assignedOfficerName} = '') and ${stillOpen} then 1 else 0 end)`,
      withoutAction: sql<number>`sum(case when (${cases.actionRequired} is null or trim(${cases.actionRequired}) = '') and ${stillOpen} then 1 else 0 end)`,
    })
    .from(cases);

  return {
    total: Number(row?.total ?? 0),
    open: Number(row?.open ?? 0),
    overdue: Number(row?.overdue ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    withoutAction: Number(row?.withoutAction ?? 0),
  };
}

export async function getCaseById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [caseRows, eventRows, referralRows, documentRows] = await Promise.all([
    db.select().from(cases).where(eq(cases.id, id)).limit(1),
    db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, id))
      .orderBy(desc(caseEvents.createdAt)),
    db
      .select()
      .from(referrals)
      .where(eq(referrals.caseId, id))
      .orderBy(desc(referrals.referredAt)),
    db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.caseId, id))
      .orderBy(desc(caseDocuments.createdAt)),
  ]);
  if (!caseRows[0]) return undefined;
  return {
    ...caseRows[0],
    events: eventRows,
    referrals: referralRows,
    documents: documentRows,
  };
}

export async function getCaseByNumber(caseNumber: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(cases)
    .where(eq(cases.caseNumber, caseNumber))
    .limit(1);
  return result[0];
}

export async function createCase(
  input: Omit<InsertCase, "caseNumber" | "year"> & {
    province: string;
    dateReceived: Date;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const year = input.dateReceived.getUTCFullYear();
  const provinceCode = input.province.toUpperCase().replace(/\s+/g, "-");
  const prefix = `PM/${provinceCode}/${year}/`;
  const existing = await db
    .select({ caseNumber: cases.caseNumber })
    .from(cases)
    .where(ilike(cases.caseNumber, `${prefix}%`));
  // §1: PM/NCD/2026/00001 - five sequential digits. Derive the next number from
  // the highest existing one rather than the row count, so a deleted matter
  // never causes a collision with the unique caseNumber constraint.
  //
  // `ilike` rather than `like` because the province code is upper-cased but a
  // matter numbered before that convention settled may hold a lower-case
  // province, and missing one would hand the next matter a duplicate prefix and
  // then a unique-constraint failure on caseNumber.
  const highest = existing.reduce((max, row) => {
    const sequence = Number.parseInt(row.caseNumber.slice(prefix.length), 10);
    return Number.isFinite(sequence) && sequence > max ? sequence : max;
  }, 0);
  const caseNumber = `${prefix}${String(highest + 1).padStart(5, "0")}`;
  await db.insert(cases).values({ ...input, year, caseNumber });
  return getCaseByNumber(caseNumber);
}

export async function updateCase(id: number, updates: Partial<InsertCase>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(sanitized).length) {
    await db.update(cases).set(sanitized).where(eq(cases.id, id));
  }
  return getCaseById(id);
}

export async function addCaseEvent(input: {
  caseId: number;
  eventType: string;
  note: string;
  actorId: number;
  actorName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(caseEvents).values(input);
  return getCaseById(input.caseId);
}

export async function createReferral(input: {
  caseId: number;
  destination: string;
  reason: string;
  criteria?: string[];
  isLegal?: boolean;
  directorNotifiedName?: string | null;
  responseDueDate?: Date | null;
  statementClaim?: string | null;
  statementVerified?: string | null;
  statementUnresolved?: string | null;
  statementAdviceRequired?: string | null;
  referredById: number;
  referredByName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const now = new Date();
  await db.insert(referrals).values({
    caseId: input.caseId,
    destination: input.destination,
    reason: input.reason,
    criteria: input.criteria?.join(",") ?? null,
    isLegal: input.isLegal ?? false,
    directorNotifiedName: input.directorNotifiedName ?? null,
    directorNotifiedAt: input.directorNotifiedName ? now : null,
    responseDueDate: input.responseDueDate ?? null,
    statementClaim: input.statementClaim ?? null,
    statementVerified: input.statementVerified ?? null,
    statementUnresolved: input.statementUnresolved ?? null,
    statementAdviceRequired: input.statementAdviceRequired ?? null,
    referredById: input.referredById,
    referredByName: input.referredByName,
    referredAt: now,
  });
  // §6: a legal matter goes to the Legal Section, everything else to REF.
  const nextStatus = input.isLegal ? "LEG" : "REF";
  await db
    .update(cases)
    .set({
      status: nextStatus,
      sectionReferred: input.destination,
      dateReferred: now,
      referredByName: input.referredByName ?? null,
      dateReferredAt: now,
      // §14 leaving the province escalates to the National Section (level 3);
      // a legal matter also sits with the Legal Section (level 6).
      escalationLevel: input.isLegal ? 6 : 3,
    })
    .where(eq(cases.id, input.caseId));
  await db.insert(caseEvents).values({
    caseId: input.caseId,
    eventType: input.isLegal ? "legal_referral" : "referral",
    note: `Referred to ${input.destination}: ${input.reason}`,
    actorId: input.referredById,
    actorName: input.referredByName,
  });
  return getCaseById(input.caseId);
}

/** §11 log a document against a matter's case file. */
export async function addCaseDocument(input: {
  caseId: number;
  documentClass: string;
  title: string;
  note?: string | null;
  fileKey?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  loggedById: number;
  loggedByName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(caseDocuments).values({
    caseId: input.caseId,
    documentClass: input.documentClass,
    title: input.title,
    note: input.note ?? null,
    fileKey: input.fileKey ?? null,
    fileName: input.fileName ?? null,
    fileSize: input.fileSize ?? null,
    mimeType: input.mimeType ?? null,
    loggedById: input.loggedById,
    loggedByName: input.loggedByName,
  });
  await db.insert(caseEvents).values({
    caseId: input.caseId,
    eventType: "document",
    note: `Case file updated: ${input.title} (${input.documentClass})`,
    actorId: input.loggedById,
    actorName: input.loggedByName,
  });
  return getCaseById(input.caseId);
}

/**
 * Remove a document from a matter's case file, and record that it happened.
 *
 * Returns null when the document is not on the named matter, so the caller can
 * answer with a not-found rather than a server error - and so the distinction
 * between "does not exist" and "exists but you may not have it" is not lost in
 * a thrown string.
 *
 * Three things this has to get right, because a case file is an accountable
 * record rather than a scratchpad:
 *
 *  - The delete is scoped to the matter as well as the row. Without that, the
 *    caseId in the request is decorative: it is only used to re-read the case
 *    afterwards, so a caller could name one matter and delete a document from
 *    another.
 *  - The removal is written to the activity timeline. Deleting the row alone
 *    would erase the only trace that the file was ever on the matter, which is
 *    precisely the audit trail §15 requires.
 *  - The storage key is returned so the caller can remove the object itself; the
 *    database does not reach into the object store.
 */
export async function deleteCaseDocument(input: {
  id: number;
  caseId: number;
  actorId: number;
  actorName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const scoped = and(
    eq(caseDocuments.id, input.id),
    eq(caseDocuments.caseId, input.caseId)
  );
  const [existing] = await db
    .select()
    .from(caseDocuments)
    .where(scoped)
    .limit(1);
  if (!existing) return null;

  await db.delete(caseDocuments).where(scoped);
  await db.insert(caseEvents).values({
    caseId: input.caseId,
    eventType: "document",
    note: `Case file: removed ${existing.title} (${existing.documentClass})${
      existing.fileName ? ` — ${existing.fileName}` : ""
    }`,
    actorId: input.actorId,
    actorName: input.actorName,
  });

  return {
    fileKey: existing.fileKey,
    case: await getCaseById(input.caseId),
  };
}

/** §12D follow-up: record the National Section's response to a referral. */
export async function recordReferralResponse(input: {
  referralId: number;
  responseSummary: string;
  responseReceivedAt?: Date | null;
  /**
   * The officer recording the response, who is not necessarily the officer who
   * made the referral. §12D gives the follow-up duty to the office, and the
   * officer discharging it is the one the accountability trail has to name.
   */
  recordedById: number;
  recordedByName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const existing = await db
    .select()
    .from(referrals)
    .where(eq(referrals.id, input.referralId))
    .limit(1);
  const referral = existing[0];
  if (!referral) throw new Error("Referral not found");
  const receivedAt = input.responseReceivedAt ?? new Date();
  await db
    .update(referrals)
    .set({
      responseSummary: input.responseSummary,
      responseReceivedAt: receivedAt,
      status: "received",
    })
    .where(eq(referrals.id, input.referralId));
  await db.insert(caseEvents).values({
    caseId: referral.caseId,
    eventType: "advice_received",
    note: `Advice received from ${referral.destination}: ${input.responseSummary}`,
    // The acting officer, not the referral's author. Taking these from the
    // referral credited whoever sent the matter to the National Section with the
    // response that came back, so the trail named the wrong person for the one
    // step §12D exists to keep on the record.
    actorId: input.recordedById,
    actorName: input.recordedByName ?? referral.referredByName,
  });
  return getCaseById(referral.caseId);
}

export async function getDashboardData() {
  const allCases = await listCases();
  const monitoring = await getCaseMonitoring(allCases);
  const activeCases = allCases.filter(
    item => !["RES", "CLS"].includes(item.status)
  );
  const overdue = allCases.filter(
    item =>
      item.dueDate &&
      item.dueDate < new Date() &&
      !["RES", "CLS"].includes(item.status)
  );
  const dueSoon = allCases.filter(item => {
    if (!item.dueDate || ["RES", "CLS"].includes(item.status)) return false;
    const diff = item.dueDate.getTime() - Date.now();
    return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
  });
  const statusCounts = allCases.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const matterCounts = allCases.reduce<Record<string, number>>((acc, item) => {
    acc[item.matterType] = (acc[item.matterType] || 0) + 1;
    return acc;
  }, {});
  const provinceCounts = allCases.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.province] = (acc[item.province] || 0) + 1;
      return acc;
    },
    {}
  );
  // Grouped over the full overdue set, not the six rows the attention table
  // shows, so the province figures agree with the overdue total.
  const overdueByProvince = Object.entries(
    overdue.reduce<Record<string, { count: number; longest: number }>>(
      (acc, item) => {
        const current = acc[item.province] ?? { count: 0, longest: 0 };
        current.count += 1;
        current.longest = Math.max(current.longest, daysOverdue(item.dueDate));
        acc[item.province] = current;
        return acc;
      },
      {}
    )
  )
    .map(([province, value]) => ({ province, ...value }))
    .sort((a, b) => b.count - a.count || b.longest - a.longest);
  return {
    totals: {
      all: allCases.length,
      active: activeCases.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
    },
    statusCounts,
    matterCounts,
    provinceCounts,
    overdueByProvince,
    monitoring,
    director: getDirectorDesk(allCases),
    intakeByMonth: getMonthlyIntake(allCases),
    closure: getClosureStats(allCases),
    recent: allCases.slice(0, 6),
    overdueCases: overdue.slice(0, 6),
  };
}

/**
 * Monthly intake for the trailing six months, oldest first. Months with no
 * matters are emitted as zero rather than omitted so the series keeps an even
 * spacing and a gap is not read as a quiet month.
 */
/**
 * §12B, the Professional Assistant's case monitoring. The manual lists exactly
 * six things the register must surface, and the order it lists them is the order
 * they are returned in:
 *
 *   new matters · outstanding matters · delay matters · legal matters ·
 *   matters awaiting National Section responses · matters requiring the
 *   Director's attention
 *
 * Every category carries the matters in it, not just a count: the PA's job is to
 * act on the list, and a number that cannot be clicked into is no use at 8am.
 */
async function getCaseMonitoring(allCases: Case[]) {
  const open = allCases.filter(item => isOpenStatus(item.status));
  const now = Date.now();

  // A pending referral is a National Section that has not answered. The manual's
  // example is "Referred to Legal on 10 September - advice outstanding", so the
  // age of the referral is what matters, not the age of the matter.
  const db = await getDb();
  if (!db) return null;
  const allReferrals = await db.select().from(referrals);
  const pendingByCase = new Map<number, (typeof allReferrals)[number][]>();
  for (const referral of allReferrals) {
    if (referral.status !== "pending") continue;
    const list = pendingByCase.get(referral.caseId) ?? [];
    list.push(referral);
    pendingByCase.set(referral.caseId, list);
  }

  const awaitingResponse = open
    .filter(item => pendingByCase.has(item.id))
    .map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      teacherName: item.teacherName,
      province: item.province,
      matterType: item.matterType,
      status: item.status,
      assignedOfficerName: item.assignedOfficerName,
      // How long the National Section has had it, which is the follow-up clock
      // §12D tells the PA to keep.
      //
      // `Math.min` over the pending referrals, not `Math.max`: the wait runs from
      // the referral that has been outstanding longest, because that is the one
      // due to be chased. Taking the newest made a matter with two outstanding
      // referrals report the shorter of the two waits, and the list below is
      // sorted longest-first precisely to surface the referral that has waited
      // longest - so the second-most-overdue referral in the office could never
      // reach the top of its own list.
      daysWaiting: Math.max(
        0,
        Math.floor(
          (now -
            Math.min(
              ...pendingByCase
                .get(item.id)!
                .map(r => new Date(r.referredAt).getTime())
            )) /
            86_400_000
        )
      ),
      responseDueDate: pendingByCase
        .get(item.id)!
        .map(r => r.responseDueDate)
        .find(Boolean) as Date | null,
      destination: pendingByCase.get(item.id)![0]?.destination ?? "",
      overdueOnFollowUp:
        pendingByCase
          .get(item.id)!
          .some(
            r =>
              r.responseDueDate && new Date(r.responseDueDate).getTime() < now
          ) ?? false,
    }))
    .sort((a, b) => b.daysWaiting - a.daysWaiting);

  // §12B.6 and §12C both turn on the same pair the server and the brief form
  // use: `briefNeedsDecision`, which is true when the matter is flagged *or*
  // already sitting at DEC. Filtering on `decisionRequired` alone listed neither
  // of these two panels for a matter the Director is being asked about, while
  // `saveBrief` refuses a brief for exactly that matter unless its two decision
  // sections are filled in - so the PA was shown nothing to prepare and then
  // told the brief was incomplete. `shared/delegation.ts` states the pair as the
  // rule; it is read from there rather than restated.
  const openBriefs = open
    .filter(
      item =>
        briefNeedsDecision(item.decisionRequired, item.status) &&
        !item.briefIssue
    )
    .map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      teacherName: item.teacherName,
      province: item.province,
      matterType: item.matterType,
      status: item.status,
      escalationLevel: item.escalationLevel,
      daysOpen: daysBetween(item.dateReceived, new Date()) ?? 0,
    }))
    .sort(
      (a, b) => b.escalationLevel - a.escalationLevel || b.daysOpen - a.daysOpen
    );

  const openIds = new Set(open.map(item => item.id));
  return {
    /** §12B.1 Matters received and not yet picked up. */
    newMatters: open.filter(item => item.status === "NEW").map(slimCase),
    /** §12B.2 Everything still open, most overdue at the top. */
    outstanding: open
      .map(item => ({
        ...slimCase(item),
        daysOpen: daysBetween(item.dateReceived, new Date()) ?? 0,
      }))
      .sort((a, b) => b.daysOpen - a.daysOpen),
    /** §12B.3 Matters past their due date. */
    delayMatters: open
      .filter(item => item.dueDate && new Date(item.dueDate).getTime() < now)
      .map(item => ({
        ...slimCase(item),
        daysOverdue: daysOverdue(item.dueDate),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue),
    /** §12B.4 Legal matters, plus anything held with the Legal Section. */
    legalMatters: allCases
      .filter(
        item =>
          item.matterType === "Legal" ||
          item.status === "LEG" ||
          allReferrals.some(r => r.caseId === item.id && r.isLegal)
      )
      .map(slimCase),
    /** §12B.5 Referred out and still waiting on a National Section. */
    awaitingResponse,
    /** §12B.6 Flagged for the Director's attention, plus anything already at DEC. */
    requiringDecision: open
      .filter(item => briefNeedsDecision(item.decisionRequired, item.status))
      .map(item => ({ ...slimCase(item), hasBrief: Boolean(item.briefIssue) }))
      .sort((a, b) => Number(a.hasBrief) - Number(b.hasBrief)),
    /** §12C. Matters flagged for decision with no brief prepared yet. */
    briefsToPrepare: openBriefs,
    counts: {
      newMatters: open.filter(item => item.status === "NEW").length,
      outstanding: open.length,
      delayMatters: open.filter(
        item => item.dueDate && new Date(item.dueDate).getTime() < now
      ).length,
      legalMatters: allCases.filter(
        item =>
          item.matterType === "Legal" ||
          item.status === "LEG" ||
          allReferrals.some(r => r.caseId === item.id && r.isLegal)
      ).length,
      awaitingResponse: awaitingResponse.length,
      requiringDecision: open.filter(item =>
        briefNeedsDecision(item.decisionRequired, item.status)
      ).length,
      briefsToPrepare: openBriefs.length,
    },
    openTotal: openIds.size,
  };
}

/** The columns a monitoring list needs, so the payload stays small. */
function slimCase(item: Case) {
  return {
    id: item.id,
    caseNumber: item.caseNumber,
    teacherName: item.teacherName,
    province: item.province,
    matterType: item.matterType,
    status: item.status,
    assignedOfficerName: item.assignedOfficerName,
  };
}

/**
 * The completed matters, most recently closed first.
 *
 * The register shows closed matters if you filter for them, but nothing surfaces
 * the fact that a matter *finished*: the board and the Director's desk are open
 * matters only, and the sanctity of the register is nearly its whole point. So
 * the closed set gets its own small list, newest first, ending where the open
 * lists begin. Used by both the register's panel and the Director's desk, so
 * the two agree about what "recently closed" means.
 */
export function getRecentlyClosed(allCases: Case[], limit = 20) {
  return allCases
    .filter(
      (item): item is Case & { dateClosed: Date } =>
        ["RES", "CLS"].includes(item.status) && !!item.dateClosed
    )
    .map(item => ({
      ...slimCase(item),
      dateClosed: item.dateClosed,
      communicatedByName: item.communicatedByName,
      daysToClose: daysBetween(item.dateReceived, item.dateClosed),
    }))
    .sort((a, b) => b.dateClosed.getTime() - a.dateClosed.getTime())
    .slice(0, limit);
}

/**
 * §6 / §12C / §13F — the Director's desk: the matters that are for the Director
 * or have been raised to him. The overview a Director lands on leads with this
 * rather than the monitoring lists that belong to the officer and the PA, so
 * his screen is his inbox, not the whole province's.
 *
 * A pure function of the cases passed in — no referrals, no database — because
 * none of the four lists needs a join, and a pure function is one that can be
 * unit-tested without a connection. It is read from the same `allCases` as the
 * rest of the dashboard, so the counts on the desk agree with the figures
 * beside them.
 *
 * What counts as "for the Director":
 *   awaitingDecision  — flagged §12B, or already sitting at DEC. The same pair
 *     `briefNeedsDecision` states and the weekly brief's §F reads.
 *   raisedToDirector  — the §14 ladder at level 2 or higher. Level 2 is
 *     "Director, Provincial Matters — requires the Director's decision or
 *     intervention". Levels 3-6 have left the province but still sit on his
 *     watch, so they are listed with their rung rather than hidden.
 *   urgent            — priority "urgent", or promoted to ESC; the same pair the
 *     weekly brief's §A surfaces.
 *   overdue           — still open and past its due date.
 */
export function getDirectorDesk(allCases: Case[]) {
  const open = allCases.filter(item => isOpenStatus(item.status));
  const now = new Date();

  const awaitingDecision = open
    .filter(item => briefNeedsDecision(item.decisionRequired, item.status))
    .map(item => ({
      ...slimCase(item),
      hasBrief: Boolean(item.briefIssue),
      issueRequiringDecision:
        item.briefIssueRequiringDecision ?? item.actionRequired,
      recommendation: item.briefRecommendation,
      daysOutstanding: daysOutstanding(item.dueDate),
    }))
    .sort(
      (a, b) =>
        Number(a.hasBrief) - Number(b.hasBrief) ||
        b.daysOutstanding - a.daysOutstanding
    );

  const raisedToDirector = open
    .filter(item => item.escalationLevel >= 2)
    .map(item => ({
      ...slimCase(item),
      escalationLevel: item.escalationLevel,
      daysOpen: daysBetween(item.dateReceived, now) ?? 0,
    }))
    .sort(
      (a, b) => a.escalationLevel - b.escalationLevel || b.daysOpen - a.daysOpen
    );

  const urgent = open
    .filter(item => item.priority === "urgent" || item.status === "ESC")
    .map(item => ({
      ...slimCase(item),
      daysOverdue: daysOverdue(item.dueDate),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const overdue = open
    .filter(
      item => item.dueDate && new Date(item.dueDate).getTime() < now.getTime()
    )
    .map(item => ({
      ...slimCase(item),
      daysOverdue: daysOverdue(item.dueDate),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const recentlyClosed = getRecentlyClosed(allCases);

  return {
    awaitingDecision,
    raisedToDirector,
    urgent,
    overdue,
    recentlyClosed,
    counts: {
      awaitingDecision: awaitingDecision.length,
      raisedToDirector: raisedToDirector.length,
      urgent: urgent.length,
      overdue: overdue.length,
      recentlyClosed: recentlyClosed.length,
    },
  };
}

function getMonthlyIntake(allCases: Case[]) {
  const now = new Date();
  const months: {
    key: string;
    label: string;
    received: number;
    closed: number;
  }[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: d.toLocaleDateString("en-AU", { month: "short" }),
      received: 0,
      closed: 0,
    });
  }
  const byKey = new Map(months.map(m => [m.key, m]));
  for (const item of allCases) {
    const received = byKey.get(monthKey(item.dateReceived));
    if (received) received.received += 1;
    if (item.dateClosed) {
      const closed = byKey.get(monthKey(item.dateClosed));
      if (closed) closed.closed += 1;
    }
  }
  return months;
}

function monthKey(value: Date | string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * How long matters actually take to close, plus the open load waiting on each
 * officer. The division rate is the useful one for a director: it is the share
 * of matters closed out of everything received, not just the closed subset.
 */
function getClosureStats(allCases: Case[]) {
  const closed = allCases.filter(
    (item): item is Case & { dateClosed: Date } =>
      ["RES", "CLS"].includes(item.status) && !!item.dateClosed
  );
  const durations = closed
    .map(item => daysBetween(item.dateReceived, item.dateClosed))
    .filter(days => days !== null);
  const open = allCases.filter(item => isOpenStatus(item.status));
  const byOfficer = open.reduce<Record<string, number>>((acc, item) => {
    const key = item.assignedOfficerName || "Unassigned";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    closedTotal: closed.length,
    closureRate: allCases.length
      ? Math.round((closed.length / allCases.length) * 100)
      : 0,
    medianDays: median(durations),
    oldestOpenDays: open.reduce(
      (max, item) =>
        Math.max(max, daysBetween(item.dateReceived, new Date()) ?? 0),
      0
    ),
    openByOfficer: Object.entries(byOfficer)
      .map(([name, open]) => ({ name, open }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
  };
}

function daysOverdue(dueDate?: Date | string | null) {
  if (!dueDate) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000)
  );
}

function daysBetween(from: Date | string, to: Date | string): number | null {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------------------------------------------------------------------------
// Platform oversight (super admin)
//
// These operate across the whole register rather than one officer's caseload.
// Reads are computed in JS after fetching, matching the existing style above
// and keeping the aggregation rules in one place.
// ---------------------------------------------------------------------------

/**
 * Accounts for the administration screen.
 *
 * The row is spread whole onto the way out, and that is safe only because the
 * stored credential is gone: Supabase holds it and never discloses it, so
 * `passwordHash` is no longer a column (migration `0001_supabase_auth.sql`).
 * There is therefore nothing secret to strip here — the comment this replaces
 * described a `select *` that would have shipped password hashes, which was
 * true of the code before Supabase and is not true of the code now. Should a
 * credential column ever be added back, this is the place that has to project
 * the fields explicitly instead of spreading the row.
 *
 * `isProvisioned` is added below rather than read from a hash's presence: the
 * `authUserId` column is the sign-inable state.
 */
export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(users).orderBy(users.role, users.name);
  const references = await getUserReferenceCounts();
  return rows.map(row => ({
    ...row,
    // Whether this officer can sign in at all, for the admin screen. Reads
    // `authUserId` rather than a stored hash: the column is the sign-inable
    // state, and a hash's presence was never evidence of anything but that
    // one had been set.
    isProvisioned: Boolean(row.authUserId),
    references: references.get(row.id) ?? NO_REFERENCES,
  }));
}

/** True when the username is already taken by another account. */
export async function usernameTaken(
  username: string,
  exceptId?: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username.trim().toLowerCase()));
  return rows.some(row => row.id !== exceptId);
}

/**
 * Everything that would be left dangling by removing an account.
 *
 * There are no foreign keys on these columns, so a delete would not fail - it
 * would quietly strip a person out of the accountability trail, and §15 requires
 * that "every office handling a matter should be identifiable". The admin screen
 * shows these counts and the delete mutation refuses when they are non-zero, so
 * removing someone from the register is never a silent one-way door.
 */
export async function getUserReferences(id: number) {
  const db = await getDb();
  if (!db) {
    return {
      casesCreated: 0,
      casesAssigned: 0,
      events: 0,
      referrals: 0,
      documents: 0,
      total: 0,
    };
  }
  // Named distinctly from the imported tables: a local called `referrals`
  // shadows the schema import and silently becomes an implicit any.
  const [created, assigned, actor, referred, filed] = await Promise.all([
    countRows(
      db.select({ id: cases.id }).from(cases).where(eq(cases.createdById, id))
    ),
    countRows(
      db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.assignedOfficerId, id))
    ),
    countRows(
      db
        .select({ id: caseEvents.id })
        .from(caseEvents)
        .where(eq(caseEvents.actorId, id))
    ),
    countRows(
      db
        .select({ id: referrals.id })
        .from(referrals)
        .where(eq(referrals.referredById, id))
    ),
    countRows(
      db
        .select({ id: caseDocuments.id })
        .from(caseDocuments)
        .where(eq(caseDocuments.loggedById, id))
    ),
  ]);
  return {
    casesCreated: created,
    casesAssigned: assigned,
    events: actor,
    referrals: referred,
    documents: filed,
    total: created + assigned + actor + referred + filed,
  };
}

async function countRows(query: Promise<{ id: number }[]>) {
  return (await query).length;
}

/** What removing an account would leave behind, per officer. */
type UserReferenceCounts = {
  casesCreated: number;
  casesAssigned: number;
  events: number;
  referrals: number;
  documents: number;
  total: number;
};

const NO_REFERENCES: UserReferenceCounts = {
  casesCreated: 0,
  casesAssigned: 0,
  events: 0,
  referrals: 0,
  documents: 0,
  total: 0,
};

/**
 * The same counts `getUserReferences` returns, for every account, in one query
 * per table instead of five per officer.
 *
 * `listUsers` used to call `getUserReferences` once per row, and each of those
 * issued five queries of its own — so the administration screen asked the
 * database thirty-one questions to draw one table, and asked all thirty at once
 * because the per-row work was a `Promise.all`. That is what exhausted the
 * server's connections: the failure is `EMAXCONN`, PostgreSQL refusing the
 * 201st client, and it arrives as a screen that never stops loading rather than
 * as anything naming a limit. Six accounts were enough to trip it on a
 * serverless deployment, where every instance brings its own pool.
 *
 * Grouping by officer collapses the same work into five queries that each
 * return one row per officer that has references, and an officer with none
 * simply has no entry — which is why the caller falls back to `NO_REFERENCES`
 * rather than expecting a zero row.
 *
 * `count()` rather than counting fetched rows in JavaScript, which is what
 * `countRows` does for the single-officer case. The difference is the whole
 * point here: the register is small now and is not going to stay small, and
 * this reads a number per group instead of every matching row.
 */
async function getUserReferenceCounts(): Promise<
  Map<number, UserReferenceCounts>
> {
  const db = await getDb();
  const counts = new Map<number, UserReferenceCounts>();
  if (!db) return counts;

  // `owner` is the officer the row hangs off and `total` how many hang off it.
  // The id comes back as a string through some drivers, so it is coerced rather
  // than trusted to be a number: a Map keyed by "781" would silently answer zero
  // for the officer whose id is 781.
  const groupByOwner = (rows: { owner: unknown; total: unknown }[]) => {
    const map = new Map<number, number>();
    for (const row of rows) map.set(Number(row.owner), Number(row.total));
    return map;
  };

  const [created, assigned, actor, referred, filed] = await Promise.all([
    groupByOwner(
      await db
        .select({ owner: cases.createdById, total: count() })
        .from(cases)
        .where(isNotNull(cases.createdById))
        .groupBy(cases.createdById)
    ),
    groupByOwner(
      await db
        .select({ owner: cases.assignedOfficerId, total: count() })
        .from(cases)
        .where(isNotNull(cases.assignedOfficerId))
        .groupBy(cases.assignedOfficerId)
    ),
    groupByOwner(
      await db
        .select({ owner: caseEvents.actorId, total: count() })
        .from(caseEvents)
        .where(isNotNull(caseEvents.actorId))
        .groupBy(caseEvents.actorId)
    ),
    groupByOwner(
      await db
        .select({ owner: referrals.referredById, total: count() })
        .from(referrals)
        .where(isNotNull(referrals.referredById))
        .groupBy(referrals.referredById)
    ),
    groupByOwner(
      await db
        .select({ owner: caseDocuments.loggedById, total: count() })
        .from(caseDocuments)
        .where(isNotNull(caseDocuments.loggedById))
        .groupBy(caseDocuments.loggedById)
    ),
  ]);

  const owners = new Set<number>([
    ...created.keys(),
    ...assigned.keys(),
    ...actor.keys(),
    ...referred.keys(),
    ...filed.keys(),
  ]);

  for (const id of owners) {
    const reference: UserReferenceCounts = {
      casesCreated: created.get(id) ?? 0,
      casesAssigned: assigned.get(id) ?? 0,
      events: actor.get(id) ?? 0,
      referrals: referred.get(id) ?? 0,
      documents: filed.get(id) ?? 0,
      total: 0,
    };
    reference.total =
      reference.casesCreated +
      reference.casesAssigned +
      reference.events +
      reference.referrals +
      reference.documents;
    counts.set(id, reference);
  }

  return counts;
}

/**
 * The account behind an officer's name, or null when the name is not an account.
 *
 * The register carries the assigned officer as a name, because that is what the
 * manual asks to be identifiable on the file, but the accountability trail is
 * counted by id: §15 requires that an officer cannot be removed while matters
 * they hold disappear with them. Matching on the name is what ties the two
 * together, so a name that no account answers for leaves the id null rather than
 * guessing at the nearest match.
 */
export async function findUserIdByName(name: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.name, name))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Remove an account outright. Only safe for an account with no history - the
 * route checks getUserReferences and refuses rather than trusting callers.
 */
export async function deleteUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(users).where(eq(users.id, id));
  return { ok: true as const };
}

/**
 * The Supabase uuid an account is linked to, so the caller can delete the
 * identity that goes with it. Null when the account was never provisioned.
 */
export async function getAuthUserIdForUser(id: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ authUserId: users.authUserId })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row?.authUserId ?? null;
}

/**
 * An account by the address Supabase signs it in with.
 *
 * Case-insensitive, because an address is not case-sensitive and Supabase will
 * happily treat `A@x.com` and `a@x.com` as one identity while this lookup would
 * otherwise return two different rows — which is how a register ends up
 * describing one officer twice.
 */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return row;
}

/**
 * Set an account's register-side label.
 *
 * Normalised to lower case on the way in, which is what `usernameTaken` compares
 * against, so the same account cannot be reachable under two spellings of one
 * name. This is not the display name — `setUserDisplayName` below is — and it is
 * not a credential: it labels the account on the register and nothing signs in
 * with it.
 */
export async function setUserUsername(id: number, username: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db
    .update(users)
    .set({ username: username.trim().toLowerCase() })
    .where(eq(users.id, id));
}

export async function setUserDisplayName(id: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ name }).where(eq(users.id, id));
}

/**
 * Link an existing row to the Supabase identity created for it.
 *
 * The two steps an administrator performs - create the identity in Supabase,
 * then point this row at it - are separate because the second must not happen if
 * the first failed, and a row pointed at a uuid that does not exist is an account
 * that can never sign in and, to a later reader, looks provisioned.
 *
 * The uuid is written last and only once, so re-running the flow after a partial
 * failure cannot silently re-point an officer's account at a different identity:
 * that would hand one person's history to another's credentials.
 */
export async function linkAuthUser(id: number, authUserId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const existing = await db
    .select({ authUserId: users.authUserId })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (existing[0]?.authUserId) {
    throw new Error(
      "This account is already linked to an identity. Deactivate or remove it before creating another."
    );
  }
  await db.update(users).set({ authUserId }).where(eq(users.id, id));
  return getUserById(id);
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

/**
 * Unlink a row from its identity, on deletion.
 *
 * `deleteUser` removes the row; the Supabase identity is removed separately by
 * the caller, which needs the service role. Clearing the column first is what
 * makes the delete safe to run before that: the row is no longer reachable by
 * any session, so a failure in the second step leaves a dead identity rather
 * than a live one pointed at a row that no longer exists.
 */
export async function clearAuthLink(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ authUserId: null }).where(eq(users.id, id));
}

export async function createUser(input: {
  openId: string;
  name: string;
  email?: string | null;
  username?: string | null;
  role: (typeof users.role.enumValues)[number];
  authUserId?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(users).values({
    openId: input.openId,
    name: input.name,
    email: input.email ?? null,
    username: input.username?.trim().toLowerCase() || null,
    // Always "supabase" now. The column survives because the audit log records
    // how an account signed in when an event was written, and an event from
    // last year is not made truer by relabelling it.
    loginMethod: "supabase",
    role: input.role,
    isActive: true,
    authUserId: input.authUserId ?? null,
  });
  return getUserByAuthUserIdOrOpenId(input.authUserId, input.openId);
}

async function getUserByAuthUserIdOrOpenId(
  authUserId: string | null | undefined,
  openId: string
) {
  if (authUserId)
    return getUserById(
      (await listUsers()).find(u => u.authUserId === authUserId)?.id ?? -1
    );
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return row;
}

export async function setUserRole(
  id: number,
  role: (typeof users.role.enumValues)[number]
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ role }).where(eq(users.id, id));
  return listUsers();
}

export async function setUserActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ isActive }).where(eq(users.id, id));
  return listUsers();
}

export type AuditFilters = {
  search?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
};

/**
 * Every recorded case action across the register, newest first, joined to the
 * matter it belongs to so the trail is readable without a second lookup.
 *
 * The filters are applied in SQL, before the limit, and the total is counted
 * under the same predicate. Both matter more here than anywhere else in the app:
 * this query used to take the newest N events and filter them in JavaScript, so
 * searching for a note written eight months ago returned nothing at all and the
 * officer concluded the action had never happened. A quiet answer is the one
 * failure mode an audit trail cannot have.
 */
export async function listAuditLog(filters: AuditFilters = {}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const search = filters.search?.trim();
  const conditions = [];
  if (filters.eventType) {
    conditions.push(eq(caseEvents.eventType, filters.eventType));
  }
  if (search) {
    // The note, the reference, the teacher and the officer who acted: the four
    // things the box on the audit screen says it searches. `ilike` because this
    // box has always been case-insensitive — see the register search above.
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(caseEvents.note, term),
        ilike(caseEvents.actorName, term),
        ilike(cases.caseNumber, term),
        ilike(cases.teacherName, term)
      )
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, counted] = await Promise.all([
    db
      .select({
        id: caseEvents.id,
        caseId: caseEvents.caseId,
        caseNumber: cases.caseNumber,
        teacherName: cases.teacherName,
        eventType: caseEvents.eventType,
        note: caseEvents.note,
        actorId: caseEvents.actorId,
        actorName: caseEvents.actorName,
        createdAt: caseEvents.createdAt,
      })
      .from(caseEvents)
      .innerJoin(cases, eq(caseEvents.caseId, cases.id))
      .where(where)
      .orderBy(desc(caseEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(caseEvents)
      .innerJoin(cases, eq(caseEvents.caseId, cases.id))
      .where(where),
  ]);

  return { rows, total: counted[0]?.value ?? 0 };
}

export async function listAuditEventTypes() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ eventType: caseEvents.eventType })
    .from(caseEvents);
  return rows.map(row => row.eventType).sort();
}

/** Provinces with at least one matter, for the oversight filter. */
export async function listProvinces() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ province: cases.province })
    .from(cases)
    .where(isNotNull(cases.province));
  return rows
    .map(row => row.province)
    .filter((province): province is string => Boolean(province))
    .sort();
}

/**
 * The officers the assignment pickers offer: every account that can still sign
 * in, by name.
 *
 * Deliberately not `listOfficers` above. That one reads the names off matters
 * already in the register, which is the right question for an oversight screen
 * reassigning history, and the wrong one for choosing who takes a matter next:
 * an officer who has never been assigned anything would be missing from it, an
 * officer who has left would still be offered, and neither is true of the
 * account list. Deactivated accounts are excluded for the same reason - a name
 * that no longer answers for anything is not an assignment.
 *
 * Returns names, not ids: the register carries the officer as a name because
 * that is what the file shows, and `findUserIdByName` derives the id on the
 * write. A name typed that matches no account stays valid and resolves to a
 * null id, which is the documented behaviour for an officer without one.
 */
export async function listActiveOfficerNames() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.name);
  return rows
    .map(row => row.name)
    .filter((name): name is string => Boolean(name));
}

/** Officers currently carrying matters, for the oversight reassignment picker. */
export async function listOfficers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ name: cases.assignedOfficerName })
    .from(cases)
    .where(isNotNull(cases.assignedOfficerName));
  return rows
    .map(row => row.name)
    .filter((name): name is string => Boolean(name))
    .sort();
}

/**
 * The trailing `count` calendar months as half-open windows, oldest first.
 *
 * A month bucket is the calendar month, so each window starts at **midnight on
 * the 1st** and ends at midnight on the 1st of the next month. Getting that
 * wrong is invisible in the code and obvious in the figures: the version this
 * replaces used `setDate(1)` without clearing the time of day, which made every
 * window `[1st at the current time, 1st of next month at the current time)` — so
 * every matter received or closed in the hours of the 1st before "now" fell into
 * the *previous* month's bar, under the previous month's label. At 14:33 that is
 * the first fourteen and a half hours of every month. This deployment runs
 * UTC+10, so it was not theoretical.
 *
 * Local midnight rather than UTC, because every other month and quarter window in
 * this file is built from local components — `getMonthlyIntake`,
 * `getMonthlyReport` and `quarterRange` all are — and a matter received at 00:30
 * on the 1st local has to land in the month the officer would name.
 *
 * Exported so the arithmetic can be asserted without a database: the loop that
 * used to hold it was untestable, which is why it could be wrong.
 */
export function monthWindows(now: Date | number, count: number) {
  const reference = new Date(now);
  const windows: { key: string; start: Date; end: Date }[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(reference);
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    start.setMonth(start.getMonth() - offset);

    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    windows.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      start,
      end,
    });
  }

  return windows;
}

export async function getSystemStats() {
  const [allCases, allUsers, audit] = await Promise.all([
    listCases(),
    listUsers(),
    listAuditLog({ limit: 1 }),
  ]);

  const now = Date.now();
  const isOpen = (status: string) => !["RES", "CLS"].includes(status);
  const active = allCases.filter(item => isOpen(item.status));
  const overdue = active.filter(
    item => item.dueDate && item.dueDate.getTime() < now
  );

  const tally = <T extends string>(rows: T[]) =>
    rows.reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  // Matters received per month over the trailing 12 months, oldest first. The
  // windows come from `monthWindows`, which owns the boundary arithmetic and the
  // reason it has to start at midnight.
  const inWindow = (
    value: Date | string | null | undefined,
    win: { start: Date; end: Date }
  ) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= win.start.getTime() && t < win.end.getTime();
  };

  const monthly = monthWindows(now, 12).map(win => ({
    month: win.key,
    received: allCases.filter(item => inWindow(item.dateReceived, win)).length,
    closed: allCases.filter(item => inWindow(item.dateClosed, win)).length,
  }));

  return {
    totals: {
      matters: allCases.length,
      active: active.length,
      overdue: overdue.length,
      overdueRate: active.length
        ? Math.round((overdue.length / active.length) * 100)
        : 0,
      users: allUsers.length,
      activeUsers: allUsers.filter(user => user.isActive).length,
      // The real count, not the length of a capped page of the trail. Reading
      // one row is enough: `total` is counted under the same predicate, so a
      // register with four thousand events reports four thousand rather than
      // stopping at whichever page size the query happened to ask for.
      auditEvents: audit.total,
    },
    byProvince: Object.entries(tally(allCases.map(item => item.province)))
      .map(([province, count]) => ({ province, count }))
      .sort(
        (a, b) => b.count - a.count || a.province.localeCompare(b.province)
      ),
    byStatus: Object.entries(tally(allCases.map(item => item.status)))
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    byMatterType: Object.entries(tally(allCases.map(item => item.matterType)))
      .map(([matterType, count]) => ({ matterType, count }))
      .sort(
        (a, b) => b.count - a.count || a.matterType.localeCompare(b.matterType)
      ),
    byRole: Object.entries(tally(allUsers.map(item => item.role)))
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    monthly,
  };
}

// ---------------------------------------------------------------------------
// §13 Director's Weekly Brief
// "Preparing a one-page weekly brief" with sections A-F. Shaped to the manual
// rather than to generic counts, because this is the Director's working
// document.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function daysOutstanding(dueDate: Date | null): number {
  if (!dueDate) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(dueDate).getTime()) / DAY_MS)
  );
}

export async function getWeeklyBrief() {
  const all = await listCases();
  const open = all.filter(item => isOpenStatus(item.status));
  const overdue = open.filter(item => isOverdue(item.status, item.dueDate));

  // A. Urgent matters
  const urgent = open
    .filter(item => item.priority === "urgent" || item.status === "ESC")
    .map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      province: item.province,
      teacherName: item.teacherName,
      matterSummary: item.matterSummary,
      actionRequired: item.actionRequired,
      status: item.status,
    }));

  // B. Legal matters: what the Legal Section action is
  const legal = open
    .filter(
      item =>
        item.matterType === "Legal" ||
        item.status === "LEG" ||
        item.sectionReferred === "Legal Section"
    )
    .map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      status: item.status,
      legalActionRequired: item.actionRequired,
      daysOutstanding: daysOutstanding(item.dueDate),
    }));

  // C / D. New, pending and resolved by matter type
  const byCategory = (category: string) => {
    const rows = all.filter(item => item.matterType === category);
    return {
      new: rows.filter(item => item.status === "NEW"),
      pending: rows.filter(
        item => isOpenStatus(item.status) && item.status !== "NEW"
      ),
      resolved: rows.filter(item => !isOpenStatus(item.status)),
    };
  };

  // E. Overdue matters: case and days outstanding
  const overdueRows = overdue
    .map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      teacherName: item.teacherName,
      assignedOfficerName: item.assignedOfficerName,
      daysOutstanding: daysOutstanding(item.dueDate),
    }))
    .sort((a, b) => b.daysOutstanding - a.daysOutstanding);

  // F. Decisions required from the Director
  const decisionsRequired = all
    .filter(item => item.decisionRequired || item.status === "DEC")
    .map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      teacherName: item.teacherName,
      matterType: item.matterType,
      issueRequiringDecision:
        item.briefIssueRequiringDecision ?? item.actionRequired,
      recommendation: item.briefRecommendation,
      daysOutstanding: daysOutstanding(item.dueDate),
    }));

  return {
    period: new Date().toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    urgent,
    legal,
    appointment: byCategory("Appointment"),
    industrial: byCategory("Industrial & General"),
    overdue: overdueRows,
    decisionsRequired,
    totals: {
      open: open.length,
      overdue: overdue.length,
      urgent: urgent.length,
      decisions: decisionsRequired.length,
    },
  };
}

// ---------------------------------------------------------------------------
// §12E / §18.8 Monthly provincial matters report
// ---------------------------------------------------------------------------

export async function getMonthlyReport(month?: string) {
  const all = await listCases();
  const now = new Date();
  const key =
    month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, monthNumber] = key.split("-").map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 1);
  const inRange = (value: Date | string | null | undefined) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= start.getTime() && t < end.getTime();
  };

  const received = all.filter(item => inRange(item.dateReceived));
  const closed = all.filter(item => inRange(item.dateClosed));
  const escalated = all.filter(
    item => item.status === "ESC" || item.escalationLevel > 0
  );

  const tally = <T extends string>(rows: T[]) =>
    rows.reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  return {
    month: key,
    label: start.toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
    }),
    received,
    closed,
    byProvince: Object.entries(tally(received.map(item => item.province)))
      .map(([province, count]) => ({ province, count }))
      .sort((a, b) => b.count - a.count),
    byCategory: Object.entries(tally(received.map(item => item.matterType)))
      .map(([matterType, count]) => ({ matterType, count }))
      .sort((a, b) => b.count - a.count),
    byStatus: Object.entries(tally(all.map(item => item.status)))
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    escalated: escalated.map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      escalationLevel: item.escalationLevel,
      status: item.status,
    })),
    totals: {
      received: received.length,
      closed: closed.length,
      outstanding: all.filter(item => isOpenStatus(item.status)).length,
      escalated: escalated.length,
    },
  };
}

// ---------------------------------------------------------------------------
// §12E Quarterly performance report
// ---------------------------------------------------------------------------

/** A quarter key such as "2026-Q3", and the calendar range it covers. */
export function quarterRange(quarter: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error(`Not a quarter: ${quarter}`);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const start = new Date(year, index * 3, 1);
  const end = new Date(year, index * 3 + 3, 1);
  return { year, index, start, end };
}

function quarterKey(date: Date) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

/** The four most recent quarters, newest first, for the period picker. */
export function listQuarters(count = 4) {
  const now = new Date();
  const keys: string[] = [];
  for (let back = 0; back < count; back += 1) {
    keys.push(
      quarterKey(new Date(now.getFullYear(), now.getMonth() - back * 3, 1))
    );
  }
  return keys.map(key => {
    const { start, end } = quarterRange(key);
    const lastDay = new Date(end.getTime() - 86_400_000);
    return {
      key,
      label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`,
      range: `${start.toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
      })} – ${lastDay.toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })}`,
    };
  });
}

/**
 * §12E, the quarterly performance report.
 *
 * A quarterly figure on its own is not a performance report - it is a count. The
 * value is in the movement, so every headline is shown against the quarter
 * before it, and the officer table is scoped to work actually done inside the
 * quarter rather than whatever caseload someone happens to be holding today.
 */
export async function getQuarterlyReport(quarter?: string) {
  const all = await listCases();
  const now = new Date();
  const key = quarter ?? quarterKey(now);
  const { start, end } = quarterRange(key);
  const prev = quarterRange(
    quarterKey(new Date(start.getFullYear(), start.getMonth() - 3, 1))
  );

  const inRange = (
    value: Date | string | null | undefined,
    from: Date,
    to: Date
  ) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= from.getTime() && t < to.getTime();
  };
  const tally = <T extends string>(rows: T[]) =>
    rows.reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  const received = all.filter(item => inRange(item.dateReceived, start, end));
  const closed = all.filter(item => inRange(item.dateClosed, start, end));
  const prevReceived = all.filter(item =>
    inRange(item.dateReceived, prev.start, prev.end)
  );
  const prevClosed = all.filter(item =>
    inRange(item.dateClosed, prev.start, prev.end)
  );

  const closureDurations = closed
    .map(item => daysBetween(item.dateReceived, item.dateClosed!))
    .filter((days): days is number => days !== null);
  const prevDurations = prevClosed
    .map(item => daysBetween(item.dateReceived, item.dateClosed!))
    .filter((days): days is number => days !== null);

  // Month by month across the three months of the quarter, so a quarter that
  // looks flat can be seen to be three very different months.
  const months = [0, 1, 2].map(offset => {
    const mStart = new Date(start.getFullYear(), start.getMonth() + offset, 1);
    const mEnd = new Date(
      start.getFullYear(),
      start.getMonth() + offset + 1,
      1
    );
    return {
      key: `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, "0")}`,
      label: mStart.toLocaleDateString("en-AU", { month: "short" }),
      received: all.filter(item => inRange(item.dateReceived, mStart, mEnd))
        .length,
      closed: all.filter(item => inRange(item.dateClosed, mStart, mEnd)).length,
    };
  });

  /**
   * Officer figures for the quarter, scoped to work done inside the period: a
   * matter received in the quarter counts for whoever received it, and a matter
   * closed in the quarter counts for whoever held it. Carrying today's caseload
   * into a historical quarter would misreport the people in it.
   */
  const names = new Set<string>();
  for (const item of all) {
    if (item.assignedOfficerName) names.add(item.assignedOfficerName);
    if (item.receivedByName) names.add(item.receivedByName);
  }
  const officers = Array.from(names)
    .map(name => {
      const receivedBy = all.filter(
        item =>
          item.receivedByName === name && inRange(item.dateReceived, start, end)
      );
      const heldAndClosed = all.filter(
        item =>
          item.assignedOfficerName === name &&
          ["RES", "CLS"].includes(item.status) &&
          inRange(item.dateClosed, start, end)
      );
      const nowOpen = all.filter(
        item => item.assignedOfficerName === name && isOpenStatus(item.status)
      );
      const durations = heldAndClosed
        .map(item => daysBetween(item.dateReceived, item.dateClosed!))
        .filter((days): days is number => days !== null);
      return {
        officer: name,
        received: receivedBy.length,
        closed: heldAndClosed.length,
        open: nowOpen.length,
        overdue: nowOpen.filter(item => isOverdue(item.status, item.dueDate))
          .length,
        escalations: all.filter(
          item =>
            item.assignedOfficerName === name &&
            item.escalationLevel > 0 &&
            inRange(item.updatedAt, start, end)
        ).length,
        // §17: taken on in the quarter with no assigned action.
        withoutAction: all.filter(
          item =>
            item.assignedOfficerName === name &&
            !item.actionRequired?.trim() &&
            inRange(item.dateReceived, start, end)
        ).length,
        medianTurnaroundDays: median(durations),
      };
    })
    .filter(row => row.received || row.closed || row.open)
    .sort((a, b) => b.closed - a.closed || a.officer.localeCompare(b.officer));

  const escalationsInQuarter = all
    .filter(item => inRange(item.updatedAt, start, end))
    .filter(item => item.escalationLevel > 0 || item.status === "ESC");

  const compliance = await getGoldenRuleCompliance();

  return {
    quarter: key,
    label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`,
    range: `${start.toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
    })} – ${new Date(end.getTime() - 86_400_000).toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`,
    comparedWith: quarterKey(prev.start),
    months,
    byProvince: Object.entries(tally(received.map(item => item.province)))
      .map(([province, count]) => ({ province, count }))
      .sort((a, b) => b.count - a.count),
    byCategory: Object.entries(tally(received.map(item => item.matterType)))
      .map(([matterType, count]) => ({ matterType, count }))
      .sort((a, b) => b.count - a.count),
    byStatus: Object.entries(tally(all.map(item => item.status)))
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    officers,
    escalations: escalationsInQuarter.map(item => ({
      id: item.id,
      caseNumber: item.caseNumber,
      teacherName: item.teacherName,
      status: item.status,
      escalationLevel: item.escalationLevel,
    })),
    compliance: {
      breaches: compliance.breaches.length,
      compliant: compliance.compliant,
      total: compliance.total,
    },
    totals: {
      received: received.length,
      closed: closed.length,
      // Share of this quarter's intake closed inside the quarter, which is the
      // honest quarterly measure: carrying last quarter's backlog into the
      // denominator would flatter a good quarter and punish a bad one.
      closureRate: received.length
        ? Math.round((closed.length / received.length) * 100)
        : 0,
      medianDaysToClose: median(closureDurations),
      outstanding: all.filter(item => isOpenStatus(item.status)).length,
      escalated: escalationsInQuarter.length,
    },
    previous: {
      received: prevReceived.length,
      closed: prevClosed.length,
      medianDaysToClose: median(prevDurations),
    },
  };
}

// ---------------------------------------------------------------------------
// §18.9 Provincial Officer Performance Report
// §15 "Every office handling a matter should be identifiable."
// ---------------------------------------------------------------------------

export async function getOfficerPerformance() {
  const all = await listCases();
  const names = new Set<string>();
  for (const item of all) {
    if (item.assignedOfficerName) names.add(item.assignedOfficerName);
    if (item.receivedByName) names.add(item.receivedByName);
  }

  return Array.from(names)
    .sort()
    .map(name => {
      const held = all.filter(item => item.assignedOfficerName === name);
      const open = held.filter(item => isOpenStatus(item.status));
      const overdue = open.filter(item => isOverdue(item.status, item.dueDate));
      const received = all.filter(item => item.receivedByName === name);
      const closed = held.filter(
        item => !isOpenStatus(item.status) && item.dateClosed
      );
      const turnaroundDays = closed.length
        ? Math.round(
            closed.reduce((total, item) => {
              const from = new Date(item.dateReceived).getTime();
              const to = new Date(item.dateClosed!).getTime();
              return total + Math.max(0, (to - from) / DAY_MS);
            }, 0) / closed.length
          )
        : null;

      return {
        officer: name,
        held: held.length,
        open: open.length,
        overdue: overdue.length,
        received: received.length,
        closed: closed.length,
        escalations: held.filter(item => item.escalationLevel > 0).length,
        // §17: matters received but never given an assigned action.
        withoutAction: held.filter(item => !item.actionRequired?.trim()).length,
        avgTurnaroundDays: turnaroundDays,
        overdueRate: open.length
          ? Math.round((overdue.length / open.length) * 100)
          : 0,
      };
    });
}

/**
 * §17 Golden Rule compliance across the register, so the Director can see where
 * the province is breaching the principle rather than discovering it later.
 */
export async function getGoldenRuleCompliance() {
  const all = await listCases();
  const breaches: { id: number; caseNumber: string; parts: string[] }[] = [];

  for (const item of all) {
    const parts: string[] = [];
    if (isOpenStatus(item.status) && !item.actionRequired?.trim())
      parts.push("assigned_action");
    if (!isOpenStatus(item.status) && !item.outcome?.trim())
      parts.push("recorded_outcome");
    if (["REF", "LEG", "ADV"].includes(item.status) && item.dueDate) {
      if (isOverdue(item.status, item.dueDate)) parts.push("referral_followup");
    }
    if (parts.length)
      breaches.push({ id: item.id, caseNumber: item.caseNumber, parts });
  }

  return {
    compliant: all.length - breaches.length,
    total: all.length,
    breaches,
  };
}

/**
 * Point an account at a new profile image, and report the key it is now
 * serving from. The key rather than a URL is stored, because the S3 object is
 * addressed by key and the served path is derived from it - the same split the
 * case file uses for `fileKey`.
 *
 * Only the caller's own account: there is no variant that writes another
 * officer's avatar, so there is no capability to check here. A platform
 * administrator changing someone's photo is an impersonation, not an
 * administrative task.
 */
export async function setUserAvatar(userId: number, avatarKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ avatarKey }).where(eq(users.id, userId));
  return { avatarKey };
}

/** Clear the avatar, so the interface falls back to the officer's initial. */
export async function clearUserAvatar(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
  return { avatarKey: null };
}
