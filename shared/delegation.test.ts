import { describe, expect, it } from "vitest";
import {
  CASE_BRIEF_CONDITIONAL_KEYS,
  CASE_BRIEF_FIELDS,
  CASE_BRIEF_MIN_LENGTH,
  briefNeedsDecision,
  caseBriefFieldError,
  validateCaseBrief,
} from "./delegation";

/**
 * §12C case brief validation.
 *
 * The length floor is stated once, in `shared/`, and read by both the server's
 * schema and the brief form. When those were written separately they drifted,
 * and the drift showed up as an officer filling in four of the six sections,
 * leaving the other two empty, and being answered with a raw schema report
 * rather than a sentence naming the box to fill in. These pin the rule and the
 * messages, so the two sides cannot quietly disagree again.
 */

const decision = CASE_BRIEF_FIELDS.find(
  field => field.key === "issueRequiringDecision"
)!;
const recommendation = CASE_BRIEF_FIELDS.find(
  field => field.key === "recommendation"
)!;

describe("§12C case brief sections", () => {
  it("carries the six sections the manual names", () => {
    expect(CASE_BRIEF_FIELDS.map(field => field.key)).toEqual([
      "issue",
      "background",
      "actionTaken",
      "currentPosition",
      "issueRequiringDecision",
      "recommendation",
    ]);
  });

  it("tells a blank section it is required", () => {
    for (const value of ["", "   ", "\n\t "]) {
      expect(caseBriefFieldError(decision, value)).toBe(
        "Issue requiring decision is required."
      );
    }
  });

  it("treats a missing value the same as a blank one", () => {
    // The form seeds from a stored brief, so a section the officer has never
    // touched arrives here as `undefined` rather than as an empty string.
    expect(caseBriefFieldError(decision, undefined)).toBe(
      "Issue requiring decision is required."
    );
  });

  it("asks for more when a section is present but too short", () => {
    expect(caseBriefFieldError(decision, "ab")).toBe(
      `Write at least ${CASE_BRIEF_MIN_LENGTH} characters in issue requiring decision.`
    );
  });

  it("measures the trimmed value, so padding is not a section", () => {
    // Four spaces pass a naive length check and store a blank brief.
    expect(caseBriefFieldError(recommendation, "    ")).toBe(
      "Recommendation is required."
    );
    expect(caseBriefFieldError(recommendation, "  ab  ")).not.toBeNull();
    expect(caseBriefFieldError(recommendation, "  okay  ")).toBeNull();
  });

  it("accepts a section at the floor and above it", () => {
    expect(caseBriefFieldError(recommendation, "okay")).toBeNull();
    expect(
      caseBriefFieldError(recommendation, "What the province recommends")
    ).toBeNull();
  });

  it("reports every failing section, keyed for the form to render", () => {
    const errors = validateCaseBrief({
      issue: "An issue for the Director",
      background: "Background on the matter",
      actionTaken: "What the province has done",
      currentPosition: "Where the matter stands",
      issueRequiringDecision: "",
      recommendation: "x",
    });

    expect(Object.keys(errors).sort()).toEqual([
      "issueRequiringDecision",
      "recommendation",
    ]);
    expect(errors.issueRequiringDecision).toBe(
      "Issue requiring decision is required."
    );
    expect(errors.recommendation).toBe(
      `Write at least ${CASE_BRIEF_MIN_LENGTH} characters in recommendation.`
    );
  });

  it("passes a complete brief", () => {
    expect(
      validateCaseBrief({
        issue: "An issue for the Director",
        background: "Background on the matter",
        actionTaken: "What the province has done",
        currentPosition: "Where the matter stands",
        issueRequiringDecision: "What needs deciding",
        recommendation: "What the province recommends",
      })
    ).toEqual({});
  });
});

describe("§12B the Director's flag governs the conditional sections", () => {
  const withoutADecision = {
    issue: "An issue for the Director",
    background: "Background on the matter",
    actionTaken: "What the province has done",
    currentPosition: "Where the matter stands",
    issueRequiringDecision: "",
    recommendation: "",
  };

  it("marks exactly the two decision sections as conditional", () => {
    expect(CASE_BRIEF_CONDITIONAL_KEYS).toEqual([
      "issueRequiringDecision",
      "recommendation",
    ]);
  });

  it("skips them for a matter that is not flagged for a decision", () => {
    expect(validateCaseBrief(withoutADecision, false)).toEqual({});
  });

  it("requires them the moment the matter is flagged", () => {
    expect(validateCaseBrief(withoutADecision, true)).toEqual({
      issueRequiringDecision: "Issue requiring decision is required.",
      recommendation: "Recommendation is required.",
    });
  });

  it("leaves the four standing sections required either way", () => {
    // The flag decides what the Director is asked, never whether the brief
    // describes the matter. Dropping these when the box is unticked would let a
    // brief be saved with nothing in it at all.
    for (const decisionRequired of [true, false]) {
      expect(
        validateCaseBrief({ ...withoutADecision, issue: "" }, decisionRequired)
          .issue
      ).toBe("Issue is required.");
    }
  });

  it("still measures a conditional section that has been written", () => {
    // Optional does not mean unchecked: a flagged matter needs a real answer,
    // and an unflagged one is not required to carry an answer at all.
    expect(
      validateCaseBrief({ ...withoutADecision, recommendation: "no" }, true)
        .recommendation
    ).toBe("Write at least 4 characters in recommendation.");
    expect(
      validateCaseBrief({ ...withoutADecision, recommendation: "no" }, false)
    ).toEqual({});
  });
});

describe("§12B what counts as asking the Director for a decision", () => {
  it("is the flag on its own", () => {
    expect(briefNeedsDecision(true)).toBe(true);
    expect(briefNeedsDecision(true, "DEC")).toBe(true);
    expect(briefNeedsDecision(true, "INV")).toBe(true);
  });

  it("is a matter already sitting at Awaiting decision", () => {
    // The status says the matter is waiting on the Director whatever the flag
    // says, and the Director's queue is built from both — so a brief judged on
    // the flag alone would let a DEC matter reach that queue saying nothing
    // about what is being decided.
    expect(briefNeedsDecision(false, "DEC")).toBe(true);
  });

  it("is neither, for a matter the province is pursuing", () => {
    expect(briefNeedsDecision(false)).toBe(false);
    expect(briefNeedsDecision(false, "NEW")).toBe(false);
    expect(briefNeedsDecision(false, "INV")).toBe(false);
    expect(briefNeedsDecision(false, "RES")).toBe(false);
    expect(briefNeedsDecision(false, undefined)).toBe(false);
  });

  it("carries the requirement into the brief's own validation", () => {
    const blank = { ...({} as Record<string, string>) };
    expect(validateCaseBrief(blank, briefNeedsDecision(false, "INV"))).toEqual({
      issue: "Issue is required.",
      background: "Background is required.",
      actionTaken: "Action taken is required.",
      currentPosition: "Current position is required.",
    });
    // The same payload, one status code apart.
    expect(
      Object.keys(validateCaseBrief(blank, briefNeedsDecision(false, "DEC")))
    ).toContain("issueRequiringDecision");
  });
});
