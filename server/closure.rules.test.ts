import { describe, expect, it } from "vitest";
import { AUDIT_PAGE_SIZE } from "../shared/pagination";
import { checkGoldenRule } from "../shared/delegation";
import { CLOSED_STATUSES, isOpenStatus } from "../shared/statuses";

/**
 * Two things the register could not do before, and which nothing was asserting.
 *
 *  - A matter could not be closed at all. RES and CLS are reachable from the
 *    status control, but §17 requires a recorded outcome, a date closed and a
 *    record of who communicated it, so every closure was refused. The figures
 *    that depend on closures — median days to close, closures per month, the
 *    closure rate — were therefore permanently zero rather than merely wrong.
 *  - An explicit `null` had to be distinguishable from "field not sent". The
 *    write path strips `undefined`, so clearing a field is only expressible as
 *    `null`; conflating the two would let a cleared outcome satisfy a closure
 *    check on the strength of the value it used to hold.
 */

const CLOSING_DATE = new Date("2026-03-14");

/** A closure the Golden Rule should accept: all three facts recorded. */
const completeClosure = {
  currentStatus: "ACT",
  nextStatus: "CLS",
  actionRequired: "Write to the teacher",
  outcome: "Reinstatement ordered with backdated leave",
  dateClosed: CLOSING_DATE,
  communicatedByName: "J. Kamau",
};

/** The three limbs of the closure rule, removed one at a time. */
describe("§17 closing a matter", () => {
  it("permits a closure with an outcome, a date and a named communicator", () => {
    expect(checkGoldenRule(completeClosure)).toEqual([]);
  });

  it("permits Resolved on the same terms as Closed", () => {
    expect(
      checkGoldenRule({ ...completeClosure, nextStatus: "RES" })
    ).toEqual([]);
  });

  it("refuses a closure with no recorded outcome", () => {
    const violations = checkGoldenRule({ ...completeClosure, outcome: null });
    expect(violations.map(v => v.part)).toContain("recorded_outcome");
    expect(violations.map(v => v.message).join(" ")).toMatch(/recorded outcome/i);
  });

  it("refuses a closure with no date closed", () => {
    const violations = checkGoldenRule({ ...completeClosure, dateClosed: null });
    expect(violations.map(v => v.message).join(" ")).toMatch(/date closed/i);
  });

  it("refuses a closure with nobody recorded as having communicated it", () => {
    const violations = checkGoldenRule({
      ...completeClosure,
      communicatedByName: null,
    });
    expect(violations.map(v => v.message).join(" ")).toMatch(/communicated/i);
  });

  it("counts the three limbs separately, so one omission is not three", () => {
    // A single missing fact should produce one reason the officer can act on.
    // Reporting the same omission three times is noise that hides which of the
    // three is still outstanding.
    const violations = checkGoldenRule({
      currentStatus: "ACT",
      nextStatus: "CLS",
      actionRequired: "Write to the teacher",
      outcome: "Reinstatement ordered",
      dateClosed: null,
      communicatedByName: "J. Kamau",
    });
    expect(violations).toHaveLength(1);
  });

  it("does not demand the action for a matter that is being closed", () => {
    // The action requirement is about not leaving a matter without a next step.
    // A closed matter has no next step, and demanding one would block the very
    // closure the rule is protecting.
    expect(
      checkGoldenRule({ ...completeClosure, actionRequired: null })
    ).toEqual([]);
  });

  it("exempts Resolved from the action requirement, as it exempts Closed", () => {
    // Both finished statuses are exempt: a resolved matter has no next step to
    // assign, so demanding an action would block the resolution the rule exists
    // to make possible.
    expect(
      checkGoldenRule({
        ...completeClosure,
        nextStatus: "RES",
        actionRequired: null,
      })
    ).toEqual([]);
  });

  it("still demands an action from a matter that is being worked", () => {
    // The requirement bites before the finish, not after it: a matter that is
    // merely being progressed may not be left without something to do.
    const violations = checkGoldenRule({
      ...completeClosure,
      nextStatus: "INV",
      actionRequired: null,
    });
    expect(violations.map(v => v.part)).toContain("assigned_action");
  });

  it("reads a cleared field as empty rather than as its former value", () => {
    // The case the `??` shortcut got wrong: the matter has an outcome on file and
    // the officer is clearing it in the same request that closes the matter.
    const stored = "Reinstatement ordered";
    const cleared = checkGoldenRule({
      ...completeClosure,
      outcome: null,
    });
    const stillHeld = checkGoldenRule({ ...completeClosure, outcome: stored });

    expect(cleared.length).toBeGreaterThan(0);
    expect(stillHeld).toEqual([]);
  });
});

describe("both finished statuses are reachable and both are finished", () => {
  it("treats Resolved and Closed as closed, and nothing else", () => {
    expect([...CLOSED_STATUSES].sort()).toEqual(["CLS", "RES"]);
    for (const status of ["NEW", "VER", "INV", "REF", "ADV", "DEC", "LEG", "ACT", "ESC"]) {
      expect(isOpenStatus(status)).toBe(true);
    }
    expect(isOpenStatus("RES")).toBe(false);
    expect(isOpenStatus("CLS")).toBe(false);
  });
});

describe("audit trail paging", () => {
  it("has a page size that the server can bound", () => {
    // The trail was a fixed 200 rows with the search applied afterwards. Paging
    // is what makes "the rest of the history" reachable at all, so the page size
    // has to be a positive integer the query can take as a limit.
    expect(AUDIT_PAGE_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(AUDIT_PAGE_SIZE)).toBe(true);
    expect(AUDIT_PAGE_SIZE).toBeLessThanOrEqual(500);
  });
});
