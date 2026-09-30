import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CLASSES,
  ESCALATION_LEVELS,
  LEGAL_CRITERIA_KEYS,
  MAX_ESCALATION_LEVEL,
  NATIONAL_SECTIONS,
  REFERRAL_CRITERIA,
  checkGoldenRule,
  isLegalReferral,
  sectionForCategory,
} from "../shared/delegation";
import {
  CLOSED_STATUSES,
  STATUS_LABELS,
  STATUS_SHORT,
  STATUS_VALUES,
  isOpenStatus,
  isOverdue,
} from "../shared/statuses";

// ---------------------------------------------------------------------------
// §10 status codes
// ---------------------------------------------------------------------------

describe("§10 standard status codes", () => {
  it("carries the eleven codes the manual lists", () => {
    expect([...STATUS_VALUES]).toEqual([
      "NEW", "VER", "INV", "REF", "ADV", "DEC", "LEG", "ACT", "RES", "CLS", "ESC",
    ]);
  });

  it("labels and short-labels every code", () => {
    for (const status of STATUS_VALUES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(STATUS_SHORT[status]).toBeTruthy();
    }
  });

  it("treats only RES and CLS as finished", () => {
    expect([...CLOSED_STATUSES]).toEqual(["RES", "CLS"]);
    expect(isOpenStatus("NEW")).toBe(true);
    expect(isOpenStatus("RES")).toBe(false);
    expect(isOpenStatus("CLS")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §17 the Golden Rule
// ---------------------------------------------------------------------------

const base = {
  currentStatus: "NEW",
  nextStatus: "INV",
  actionRequired: "Verify appointment record",
  outcome: null,
  dateClosed: null,
  communicatedByName: null,
};

describe("§17 Golden Rule", () => {
  it("permits a normal progression with an assigned action", () => {
    expect(checkGoldenRule(base)).toEqual([]);
  });

  it("blocks leaving 'New' without an assigned action", () => {
    const violations = checkGoldenRule({ ...base, actionRequired: "" });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.part).toBe("assigned_action");
    expect(violations[0]?.message).toMatch(/assigned action/i);
  });

  it("blocks closing without a recorded outcome", () => {
    const violations = checkGoldenRule({
      ...base,
      nextStatus: "CLS",
      outcome: "",
      dateClosed: new Date(),
      communicatedByName: "J. Kumul",
    });
    expect(violations.map((v) => v.part)).toContain("recorded_outcome");
  });

  it("blocks closing without a closure date", () => {
    const violations = checkGoldenRule({
      ...base,
      nextStatus: "RES",
      outcome: "Appointment confirmed by the Appointments Section",
      dateClosed: null,
      communicatedByName: "J. Kumul",
    });
    expect(violations.map((v) => v.part)).toContain("recorded_outcome");
  });

  it("blocks closing without recording who communicated the outcome", () => {
    const violations = checkGoldenRule({
      ...base,
      nextStatus: "RES",
      outcome: "Appointment confirmed by the Appointments Section",
      dateClosed: new Date(),
      communicatedByName: null,
    });
    expect(violations.some((v) => /communicated/i.test(v.message))).toBe(true);
  });

  it("permits a fully documented closure", () => {
    expect(
      checkGoldenRule({
        ...base,
        nextStatus: "CLS",
        outcome: "Appointment confirmed by the Appointments Section",
        dateClosed: new Date(),
        communicatedByName: "J. Kumul",
      }),
    ).toEqual([]);
  });

  it("does not demand an action for a matter that is still New", () => {
    expect(checkGoldenRule({ ...base, nextStatus: "NEW", actionRequired: "" })).toEqual([]);
  });

  it("blocks a referred matter left without a follow-up date", () => {
    const violations = checkGoldenRule({
      ...base,
      nextStatus: "REF",
      awaitingResponse: true,
      referralResponseDueDate: null,
    });
    expect(violations.map((v) => v.part)).toContain("referral_followup");
  });

  it("accepts a referred matter that has a response due date", () => {
    expect(
      checkGoldenRule({
        ...base,
        nextStatus: "REF",
        awaitingResponse: true,
        referralResponseDueDate: new Date(),
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 and §5 referral rules
// ---------------------------------------------------------------------------

describe("§3 National Section authority", () => {
  it("routes each matter category to its primary technical authority", () => {
    expect(sectionForCategory("Appointment")).toBe("Appointments");
    expect(sectionForCategory("Industrial & General")).toBe("Industrial and General");
    expect(sectionForCategory("Legal")).toBe("Legal Section");
  });

  it("lists the six authorities from the manual table", () => {
    expect(NATIONAL_SECTIONS).toHaveLength(6);
    expect(NATIONAL_SECTIONS.map((s) => s.key)).toContain("legal");
  });
});

describe("§5 referral criteria", () => {
  it("lists the triggers the manual gives", () => {
    expect(REFERRAL_CRITERIA.length).toBeGreaterThanOrEqual(10);
    for (const criterion of REFERRAL_CRITERIA) {
      expect(criterion.text.length).toBeGreaterThan(5);
    }
  });

  it("routes a matter with any legal trigger to the legal path", () => {
    const legal = LEGAL_CRITERIA_KEYS[0];
    expect(isLegalReferral([legal])).toBe(true);
    expect(isLegalReferral(["outside_delegation", "commission_decision"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §11 and §14
// ---------------------------------------------------------------------------

describe("§11 case file", () => {
  it("carries the eleven document classes the manual lists", () => {
    expect(DOCUMENT_CLASSES).toHaveLength(11);
    expect(DOCUMENT_CLASSES.map((d) => d.key)).toContain("original_application");
    expect(DOCUMENT_CLASSES.map((d) => d.key)).toContain("closure_record");
  });

  it("marks the closure record and decisions as required before closure", () => {
    const required = DOCUMENT_CLASSES.filter((d) => d.requiredForClosure).map((d) => d.key);
    expect(required).toContain("original_application");
    expect(required).toContain("decisions");
    expect(required).toContain("communication_to_teacher");
    expect(required).toContain("closure_record");
  });
});

describe("§14 escalation ladder", () => {
  it("runs from the officer up to the Commission and the Legal Section", () => {
    expect(ESCALATION_LEVELS[0]?.label).toBe("Officer");
    const labels = ESCALATION_LEVELS.map((level) => level.label);
    expect(labels).toContain("Director, Provincial Matters");
    expect(labels).toContain("Commission");
    expect(labels).toContain("Legal Section");
  });

  it("keeps the highest level addressable by the API", () => {
    expect(Math.max(...ESCALATION_LEVELS.map((l) => l.level))).toBe(MAX_ESCALATION_LEVEL);
  });
});

describe("overdue detection", () => {
  it("ignores a finished matter however late its due date", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(isOverdue("RES", past)).toBe(false);
    expect(isOverdue("CLS", past)).toBe(false);
    expect(isOverdue("INV", past)).toBe(true);
    expect(isOverdue("INV", null)).toBe(false);
  });
});
