import { describe, expect, it } from "vitest";
import { getDirectorDesk, getRecentlyClosed } from "./db";
import type { Case } from "../drizzle/schema";

/**
 * The Director's desk is a pure function of the cases passed in - no database,
 * no referrals - so the grouping rules get the same direct scrutiny as any
 * other predicate in `shared`. These fixtures are deliberately small: each test
 * isolates the one signal it names, and a matter is never present in two lists
 * at once unless the semantics genuinely overlap (urgent and overdue both
 * carry a days-overdue column, but the lists themselves are disjoint).
 */

const DAY = 86_400_000;
const TEN_DAYS_AGO = new Date(Date.now() - 10 * DAY);
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * DAY);
const IN_THIRTY_DAYS = new Date(Date.now() + 30 * DAY);

function fixture(overrides: Partial<Case>): Case {
  return {
    id: 1,
    caseNumber: "DEMO/TCH/2026/0001",
    year: 2026,
    province: "NCD",
    dateReceived: TEN_DAYS_AGO,
    teacherName: "Test Teacher",
    employeeReference: null,
    matterType: "Industrial & General",
    matterSummary: "Test summary",
    assignedOfficerId: null,
    assignedOfficerName: null,
    sectionReferred: null,
    status: "INV",
    actionRequired: "Verify and respond in writing",
    dueDate: IN_THIRTY_DAYS,
    outcome: null,
    dateClosed: null,
    priority: "normal",
    escalationLevel: 0,
    briefIssue: null,
    briefBackground: null,
    briefActionTaken: null,
    briefCurrentPosition: null,
    briefIssueRequiringDecision: null,
    briefRecommendation: null,
    briefPreparedByName: null,
    briefPreparedAt: null,
    decisionRequired: false,
    referredByName: null,
    dateReferredAt: null,
    createdById: 42,
    createdByName: "Officer",
    receivedByName: "Officer",
    processedByName: null,
    decidedByName: null,
    communicatedByName: null,
    createdAt: TEN_DAYS_AGO,
    updatedAt: TEN_DAYS_AGO,
    ...overrides,
  };
}

describe("getDirectorDesk · awaitingDecision", () => {
  it("includes a matter flagged for the Director under §12B", () => {
    const desk = getDirectorDesk([fixture({ decisionRequired: true })]);
    expect(desk.awaitingDecision.map(c => c.id)).toEqual([1]);
    expect(desk.counts.awaitingDecision).toBe(1);
  });

  it("includes a matter already sitting at DEC, without a flag", () => {
    const desk = getDirectorDesk([fixture({ status: "DEC" })]);
    expect(desk.awaitingDecision.map(c => c.id)).toEqual([1]);
  });

  it("leaves an unflagged, non-DEC matter off the decision list", () => {
    const desk = getDirectorDesk([fixture({ status: "INV" })]);
    expect(desk.awaitingDecision).toEqual([]);
    expect(desk.counts.awaitingDecision).toBe(0);
  });

  it("carries the brief: whether one exists and what it recommends", () => {
    const desk = getDirectorDesk([
      fixture({
        decisionRequired: true,
        briefIssue: "background",
        briefIssueRequiringDecision: "says pay the allowance",
        briefRecommendation: "pay the allowance",
      }),
    ]);
    expect(desk.awaitingDecision[0]).toMatchObject({
      hasBrief: true,
      issueRequiringDecision: "says pay the allowance",
      recommendation: "pay the allowance",
    });
  });
});

describe("getDirectorDesk · raisedToDirector", () => {
  it("includes a matter on the Director's rung of the ladder (level 2)", () => {
    const desk = getDirectorDesk([fixture({ escalationLevel: 2 })]);
    expect(desk.raisedToDirector.map(c => c.id)).toEqual([1]);
  });

  it("includes rungs above the Director, which sit on his watch", () => {
    const desk = getDirectorDesk([fixture({ escalationLevel: 5 })]);
    expect(desk.raisedToDirector.map(c => c.id)).toEqual([1]);
    expect(desk.raisedToDirector[0].escalationLevel).toBe(5);
  });

  it("does not include a matter sitting with the senior officer (level 1)", () => {
    const desk = getDirectorDesk([fixture({ escalationLevel: 1 })]);
    expect(desk.raisedToDirector).toEqual([]);
  });
});

describe("getDirectorDesk · urgent", () => {
  it("includes a matter marked urgent", () => {
    const desk = getDirectorDesk([fixture({ priority: "urgent" })]);
    expect(desk.urgent.map(c => c.id)).toEqual([1]);
  });

  it("includes a matter promoted to Escalated due to delay", () => {
    const desk = getDirectorDesk([fixture({ status: "ESC" })]);
    expect(desk.urgent.map(c => c.id)).toEqual([1]);
  });

  it("leaves a normal, open matter off the urgent list", () => {
    const desk = getDirectorDesk([fixture({ priority: "normal" })]);
    expect(desk.urgent).toEqual([]);
  });
});

describe("getDirectorDesk · overdue", () => {
  it("includes an open matter past its due date", () => {
    const desk = getDirectorDesk([fixture({ dueDate: FIVE_DAYS_AGO })]);
    expect(desk.overdue.map(c => c.id)).toEqual([1]);
  });

  it("leaves a closed matter past its due date off the list", () => {
    const desk = getDirectorDesk([
      fixture({ dueDate: FIVE_DAYS_AGO, status: "RES" }),
    ]);
    expect(desk.overdue).toEqual([]);
  });

  it("leaves an open matter not yet due off the list", () => {
    const desk = getDirectorDesk([fixture({ dueDate: IN_THIRTY_DAYS })]);
    expect(desk.overdue).toEqual([]);
  });
});

describe("getDirectorDesk · closed matters never reach the desk", () => {
  it("does not offer a closed matter the Director was flagged on", () => {
    const desk = getDirectorDesk([
      fixture({
        decisionRequired: true,
        status: "CLS",
        dateClosed: TEN_DAYS_AGO,
      }),
    ]);
    expect(desk.awaitingDecision).toEqual([]);
  });

  it("does not offer a closed matter that was on the Director's rung", () => {
    const desk = getDirectorDesk([
      fixture({ escalationLevel: 2, status: "CLS", dateClosed: TEN_DAYS_AGO }),
    ]);
    expect(desk.raisedToDirector).toEqual([]);
  });
});

describe("getRecentlyClosed", () => {
  it("returns only completed matters", () => {
    const closed = fixture({
      id: 1,
      status: "CLS",
      dateClosed: TEN_DAYS_AGO,
    });
    const open = fixture({ id: 2, status: "INV", dateClosed: null });
    expect(getRecentlyClosed([open, closed]).map(c => c.id)).toEqual([1]);
  });

  it("puts the most recently closed matter first", () => {
    const older = fixture({ id: 1, status: "RES", dateClosed: TEN_DAYS_AGO });
    const newer = fixture({ id: 2, status: "CLS", dateClosed: new Date() });
    expect(getRecentlyClosed([older, newer]).map(c => c.id)).toEqual([2, 1]);
  });

  it("counts how long a matter took to close", () => {
    const closed = fixture({
      status: "CLS",
      dateReceived: new Date(Date.now() - 10 * DAY),
      dateClosed: new Date(Date.now() - DAY),
    });
    const [row] = getRecentlyClosed([closed]);
    expect(row.daysToClose).toBe(9);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      fixture({
        id: index + 1,
        status: "CLS",
        dateClosed: new Date(Date.now() - (index + 1) * DAY),
      })
    );
    expect(getRecentlyClosed(many, 3)).toHaveLength(3);
  });

  it("appears on the Director's desk with its own count", () => {
    const desk = getDirectorDesk([
      fixture({ status: "CLS", dateClosed: TEN_DAYS_AGO }),
    ]);
    expect(desk.recentlyClosed).toHaveLength(1);
    expect(desk.counts.recentlyClosed).toBe(1);
  });
});
