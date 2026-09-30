import {
  and,
  desc,
  eq,
  isNotNull,
  like,
  lt,
  notInArray,
  or,
  sql,
  count,
} from "drizzle-orm";
import { CLOSED_STATUSES, isOpenStatus, isOverdue } from "../shared/statuses";
import { drizzle } from "drizzle-orm/mysql2";
import {
  caseDocuments,
  caseEvents,
  cases,
  referrals,
  type Case,
  type InsertCase,
  type InsertUser,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _flavourChecked = false;

/**
 * The platform targets MariaDB 12. Because MariaDB speaks the MySQL wire
 * protocol there is nothing in the config that distinguishes it from MySQL, so
 * log the server we actually reached once per process. This is how a mismatch
 * gets noticed rather than assumed.
 */
async function logServerFlavour(db: NonNullable<ReturnType<typeof drizzle>>) {
  if (_flavourChecked) return;
  _flavourChecked = true;
  try {
    const result = await db.execute(sql`SELECT VERSION() AS version`);
    // The mysql2 driver returns a [rows, fields] tuple for a plain query.
    const rows =
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    const version = (rows as { version?: string }[])?.[0]?.version ?? "unknown";
    const flavour = /mariadb/i.test(version) ? "MariaDB" : "MySQL-compatible";
    console.log(`[Database] Connected to ${flavour} ${version}`);
  } catch (error) {
    console.warn("[Database] Could not determine server version:", error);
  }
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
      await logServerFlavour(_db);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

/**
 * The user behind a session. This row becomes `ctx.user`, which the client reads
 * through `auth.me`, so the stored credential is stripped here rather than at
 * each call site: a raw select would hand the password hash to the browser on
 * every request. Anything that genuinely needs the hash reads it through
 * `getUserByLocalUsername`, which is only ever called server-side.
 */
export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  if (!result[0]) return undefined;
  const { passwordHash: _hash, ...safe } = result[0];
  return safe;
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
    conditions.push(
      or(
        like(cases.caseNumber, `%${filters.search}%`),
        like(cases.teacherName, `%${filters.search}%`)
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
    .where(like(cases.caseNumber, `${prefix}%`));
  // §1: PM/NCD/2026/00001 - five sequential digits. Derive the next number from
  // the highest existing one rather than the row count, so a deleted matter
  // never causes a collision with the unique caseNumber constraint.
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
      daysWaiting: Math.max(
        0,
        Math.floor(
          (now -
            Math.max(
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

  const openBriefs = open
    .filter(item => item.decisionRequired && !item.briefIssue)
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
    /** §12B.6 Flagged for the Director's attention. */
    requiringDecision: open
      .filter(item => item.decisionRequired)
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
      requiringDecision: open.filter(item => item.decisionRequired).length,
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
 * The stored credential is deliberately reduced to a boolean before it leaves
 * the server. A `select *` here would ship password hashes to the browser, where
 * they could be read by a browser extension, captured in a proxy log, or cached
 * in client state - the hash is not a secret the platform should hand out, and
 * the UI only needs to know whether a credential exists.
 */
export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(users).orderBy(users.role, users.name);
  return Promise.all(
    rows.map(async ({ passwordHash, ...rest }) => ({
      ...rest,
      hasPassword: Boolean(passwordHash),
      references: await getUserReferences(rest.id),
    }))
  );
}

/**
/**
 * Resolve a typed username to an account, including the stored credential.
 *
 * The explicit `username` column is the real answer. Two fallbacks are kept so
 * accounts provisioned before usernames existed still sign in: the local part of
 * the email, then the openId.
 *
 * Unlike every other reader in this file this one DOES return the hash, because
 * verifying a password needs it. It is therefore server-side only: never return
 * this row from a tRPC procedure.
 */
export async function getUserByLocalUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalised = username.trim().toLowerCase();
  if (!normalised) return undefined;

  const [byUsername] = await db
    .select()
    .from(users)
    .where(eq(users.username, normalised))
    .limit(1);
  if (byUsername) return byUsername;

  const [byEmail] = await db
    .select()
    .from(users)
    .where(like(users.email, `${normalised}@%`))
    .limit(1);
  if (byEmail) return byEmail;

  const [byOpenId] = await db
    .select()
    .from(users)
    .where(eq(users.openId, normalised))
    .limit(1);
  return byOpenId;
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
 * Set an account's display name. Separate from the credential because the name
 * is what the party backfill matches against, and a local login created from a
 * username needs its real name set before it can be linked to any matter.
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

/** Attach or replace a local credential on an account. */
export async function setUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  return getUserByOpenId(
    (await listUsers()).find(u => u.id === id)?.openId ?? ""
  );
}

export async function createUser(input: {
  openId: string;
  name: string;
  email?: string | null;
  username?: string | null;
  role: (typeof users.role.enumValues)[number];
  passwordHash?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(users).values({
    openId: input.openId,
    name: input.name,
    email: input.email ?? null,
    username: input.username?.trim().toLowerCase() || null,
    loginMethod: input.passwordHash ? "local" : "admin",
    role: input.role,
    isActive: true,
    passwordHash: input.passwordHash ?? null,
  });
  return getUserByOpenId(input.openId);
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
    // things the box on the audit screen says it searches.
    const term = `%${search}%`;
    conditions.push(
      or(
        like(caseEvents.note, term),
        like(caseEvents.actorName, term),
        like(cases.caseNumber, term),
        like(cases.teacherName, term)
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

  // Matters received per month over the trailing 12 months, oldest first.
  const monthly: { month: string; received: number; closed: number }[] = [];
  for (let offset = 11; offset >= 0; offset--) {
    const point = new Date(now);
    point.setDate(1);
    point.setMonth(point.getMonth() - offset);
    const key = `${point.getFullYear()}-${String(point.getMonth() + 1).padStart(2, "0")}`;
    const next = new Date(point);
    next.setMonth(next.getMonth() + 1);
    monthly.push({
      month: key,
      received: allCases.filter(item => {
        const t = new Date(item.dateReceived).getTime();
        return t >= point.getTime() && t < next.getTime();
      }).length,
      closed: allCases.filter(item => {
        if (!item.dateClosed) return false;
        const t = new Date(item.dateClosed).getTime();
        return t >= point.getTime() && t < next.getTime();
      }).length,
    });
  }

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
