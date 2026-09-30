// Reference tables taken directly from the TSC Provincial Matters Administration
// Manual. These are policy, not configuration, so they live in shared code and
// are enforced identically on the server and in the UI.

import type { CaseStatus } from "./statuses";

// ---------------------------------------------------------------------------
// §3 Relationship with National TSC Sections
// The provincial officer is the link between the teacher and the National
// Section holding primary technical authority for the subject matter.
// ---------------------------------------------------------------------------

export type MatterCategory = "Appointment" | "Industrial & General" | "Legal";

export const MATTER_CATEGORIES: readonly MatterCategory[] = [
  "Appointment",
  "Industrial & General",
  "Legal",
];

export type NationalSectionKey =
  | "appointments"
  | "industrial"
  | "legal"
  | "policy"
  | "records"
  | "provincial";

export const NATIONAL_SECTIONS: {
  key: NationalSectionKey;
  label: string;
  /** The subject matter this section holds primary technical authority over. */
  authority: string;
  /** Matters routed here carry these reference statuses. */
  statuses: CaseStatus[];
}[] = [
  {
    key: "appointments",
    label: "Appointments",
    authority: "Appointment, selection and tenure",
    statuses: ["REF", "ADV", "DEC"],
  },
  {
    key: "industrial",
    label: "Industrial and General",
    authority: "Salary, allowances and conditions of service",
    statuses: ["REF", "ADV", "DEC"],
  },
  {
    key: "legal",
    label: "Legal Section",
    authority: "Legal interpretation and legal proceedings",
    statuses: ["LEG", "REF", "ADV"],
  },
  {
    key: "policy",
    label: "Relevant Policy / Management authority",
    authority: "Policy interpretation",
    statuses: ["REF", "ADV"],
  },
  {
    key: "records",
    label: "Relevant records / HR functions (ICT)",
    authority: "Teacher records and data",
    statuses: ["VER", "REF"],
  },
  {
    key: "provincial",
    label: "Provincial Matters",
    authority: "Provincial service delivery",
    statuses: ["NEW", "VER", "INV", "ACT", "RES", "CLS", "ESC"],
  },
];

/** §3: the National Section a matter category is referred to by default. */
export const DEFAULT_DESTINATION: Record<MatterCategory, string> = {
  Appointment: "Appointments",
  "Industrial & General": "Industrial and General",
  Legal: "Legal Section",
};

export function sectionForCategory(category: MatterCategory): string {
  return DEFAULT_DESTINATION[category];
}

// ---------------------------------------------------------------------------
// §5 Matters that should be referred
// "A Provincial officer should refer a matter when:" - a matter cannot be held
// indefinitely, so the officer records which trigger applied rather than
// free-texting the reason.
// ---------------------------------------------------------------------------

export const REFERRAL_CRITERIA: {
  key: string;
  text: string;
  legalOnly?: boolean;
}[] = [
  {
    key: "outside_delegation",
    text: "It is outside the officer's delegated authority",
  },
  {
    key: "commission_decision",
    text: "It requires a decision by the Commission",
  },
  {
    key: "legislation",
    text: "It involves interpretation of legislation",
    legalOnly: true,
  },
  {
    key: "statutory_entitlement",
    text: "It involves a dispute over a statutory entitlement",
    legalOnly: true,
  },
  {
    key: "appointment_appeal",
    text: "It involves a formal appointment appeal",
  },
  {
    key: "industrial_dispute",
    text: "It involves a significant industrial dispute",
  },
  {
    key: "court_proceedings",
    text: "It involves threatened or actual court proceedings",
    legalOnly: true,
  },
  {
    key: "lawyers_letter",
    text: "A lawyer's letter has been served",
    legalOnly: true,
  },
  {
    key: "judicial_review",
    text: "The matter involves judicial review",
    legalOnly: true,
  },
  {
    key: "law_uncertainty",
    text: "There is uncertainty about the applicable law or policy",
    legalOnly: true,
  },
  {
    key: "financial_implications",
    text: "The matter has potential financial or legal implications for the Commission",
  },
];

/**
 * §6: legal matters take a distinct path and provincial officers must not give
 * their own legal opinions. Anything matching a legal trigger is referred as a
 * legal referral regardless of the matter category.
 */
export const LEGAL_CRITERIA_KEYS = REFERRAL_CRITERIA.filter(
  criterion => criterion.legalOnly
).map(criterion => criterion.key);

export function isLegalReferral(criteriaKeys: string[]): boolean {
  return criteriaKeys.some(key => LEGAL_CRITERIA_KEYS.includes(key));
}

// ---------------------------------------------------------------------------
// §14 Escalation System
// "A matter should not remain indefinitely with an officer."
// ---------------------------------------------------------------------------

export const ESCALATION_LEVELS: {
  level: number;
  label: string;
  description: string;
}[] = [
  {
    level: 0,
    label: "Officer",
    description: "Held by the responsible provincial matter officer",
  },
  {
    level: 1,
    label: "Senior / Regional officer",
    description: "Referred upward within the province",
  },
  {
    level: 2,
    label: "Director, Provincial Matters",
    description: "Requires the Director's decision or intervention",
  },
  {
    level: 3,
    label: "Relevant National Section",
    description: "Referred out of the province for determination",
  },
  {
    level: 4,
    label: "Commissioner / Management",
    description: "Requires management-level determination",
  },
  {
    level: 5,
    label: "Commission",
    description: "A matter for the Commission itself",
  },
  {
    level: 6,
    label: "Legal Section",
    description: "Where legal issues arise, in parallel with the above",
  },
];

export const MAX_ESCALATION_LEVEL = 6;

export function escalationLabel(level: number | null | undefined): string {
  const match = ESCALATION_LEVELS.find(item => item.level === level);
  return match?.label ?? "Officer";
}

// ---------------------------------------------------------------------------
// §11 File Management
// "Each matter should have a complete case file containing:" - the classes below
// are the checklist a file is expected to satisfy before closure.
// ---------------------------------------------------------------------------

export const DOCUMENT_CLASSES: {
  key: string;
  label: string;
  requiredForClosure: boolean;
}[] = [
  {
    key: "original_application",
    label: "Original application / query",
    requiredForClosure: true,
  },
  {
    key: "supporting_documents",
    label: "Supporting documents",
    requiredForClosure: false,
  },
  {
    key: "correspondence_received",
    label: "Correspondence received",
    requiredForClosure: false,
  },
  {
    key: "correspondence_sent",
    label: "Correspondence sent",
    requiredForClosure: false,
  },
  {
    key: "investigation_notes",
    label: "Investigation notes",
    requiredForClosure: false,
  },
  {
    key: "relevant_records",
    label: "Relevant records",
    requiredForClosure: false,
  },
  {
    key: "referral_letter",
    label: "Referral letter",
    requiredForClosure: false,
  },
  {
    key: "advice_received",
    label: "Advice received",
    requiredForClosure: false,
  },
  { key: "decisions", label: "Decisions", requiredForClosure: true },
  {
    key: "communication_to_teacher",
    label: "Evidence of communication to the teacher",
    requiredForClosure: true,
  },
  { key: "closure_record", label: "Closure record", requiredForClosure: true },
];

export const DOCUMENT_CLASS_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_CLASSES.map(item => [item.key, item.label])
);

/**
 * The class keys as a zod-compatible tuple, for the input validator. Kept here
 * rather than in the router so the client and the server agree on one list
 * instead of the router deriving its own.
 */
export const DOCUMENT_CLASS_KEYS = DOCUMENT_CLASSES.map(item => item.key) as [
  string,
  ...string[],
];

/**
 * File types the case file accepts, and the ceiling on one.
 *
 * Declared here because both ends need it and they must not drift: the server
 * sniffs the bytes against this list and refuses anything else, and the client
 * needs it to narrow `File.type` before sending. A file's declared type is only
 * a claim - the server checks the bytes - but sending a type the schema would
 * reject is a wasted round trip.
 *
 * The list is deliberately short. These are the formats an office actually
 * receives, and nothing executable is on it: a case file is read by people.
 */
export const CASEFILE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
] as const;

export type CasefileMimeType = (typeof CASEFILE_MIME_TYPES)[number];

/**
 * 10MB. Must stay under what the database accepts in one packet once the bytes
 * are base64-encoded into JSON, which inflates them by a third - see
 * DOCUMENT_MAX_BYTES in server/routers.ts and the note there about
 * max_allowed_packet.
 */
export const CASEFILE_MAX_BYTES = 10 * 1024 * 1024;

/** Narrows a browser-reported file type to the accepted set. */
export function isCasefileMimeType(type: string): type is CasefileMimeType {
  return (CASEFILE_MIME_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// §12C Case brief for the Director
// "Before presenting a matter to the Director, prepare a short case report."
// ---------------------------------------------------------------------------

export const CASE_BRIEF_FIELDS: {
  key: string;
  label: string;
  hint: string;
  /**
   * Set on the two sections that exist only for a matter the Director is being
   * asked to decide something about. A brief with nothing to put to the Director
   * should not have to invent a decision to complete it.
   */
  conditional?: boolean;
}[] = [
  { key: "issue", label: "Issue", hint: "What is the problem" },
  { key: "background", label: "Background", hint: "What happened" },
  {
    key: "actionTaken",
    label: "Action taken",
    hint: "What has already been done",
  },
  {
    key: "currentPosition",
    label: "Current position",
    hint: "Where is the matter now",
  },
  {
    key: "issueRequiringDecision",
    label: "Issue requiring decision",
    hint: "What does the Director need to decide",
    conditional: true,
  },
  {
    key: "recommendation",
    label: "Recommendation",
    hint: "What action is proposed",
    conditional: true,
  },
];

/** The brief sections that are only required when a decision is being sought. */
export const CASE_BRIEF_CONDITIONAL_KEYS = CASE_BRIEF_FIELDS.filter(
  field => field.conditional
).map(field => field.key);

/**
 * The shortest a brief section may be, in characters.
 *
 * Four is not a claim about how long a case report ought to be — it is the
 * floor below which the section is blank rather than brief. It lives here, next
 * to the field list, because the server's schema and the brief form's own
 * validation both enforce it: when they were written separately they drifted,
 * and the result was an officer who filled in four sections, left the fifth
 * empty, and was answered with a raw schema dump instead of a sentence about
 * which section was missing.
 */
export const CASE_BRIEF_MIN_LENGTH = 4;

/**
 * Validates one brief section.
 *
 * Returns the message to show against that field, or `null` when it is
 * acceptable. Blank and too-short are told apart on purpose: "this is required"
 * and "write a bit more" are different instructions, and collapsing them into
 * one message is how an officer ends up typing four characters to get past a
 * check they did not understand.
 */
export function caseBriefFieldError(
  field: { key: string; label: string },
  value: string | undefined
): string | null {
  const length = (value ?? "").trim().length;
  if (length === 0) return `${field.label} is required.`;
  if (length < CASE_BRIEF_MIN_LENGTH) {
    return `Write at least ${CASE_BRIEF_MIN_LENGTH} characters in ${field.label.toLowerCase()}.`;
  }
  return null;
}

/**
 * Whether a matter is asking the Director for something.
 *
 * The §12B flag is the officer's instrument for saying so, but it is not the
 * only signal: a matter sitting at DEC — "Awaiting decision" — is asking by its
 * status whatever the flag says. The Director's own queue is built from both
 * (`decisionRequired || status === "DEC"`), so the brief has to be judged on the
 * same pair, or a matter can appear in that queue with a brief that never says
 * what is being decided.
 */
export function briefNeedsDecision(
  decisionRequired: boolean,
  status?: string
): boolean {
  return decisionRequired || status === "DEC";
}

/**
 * Every failing section of a brief, keyed by field, ready to render.
 *
 * `needsDecision` decides whether the two conditional sections are checked at
 * all. A matter nobody is asking a decision of has nothing for the Director to
 * decide, so requiring one would mean every brief for a matter the province is
 * simply pursuing carried two invented sections.
 */
export function validateCaseBrief(
  values: Record<string, string | undefined>,
  needsDecision = true
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of CASE_BRIEF_FIELDS) {
    if (field.conditional && !needsDecision) continue;
    const message = caseBriefFieldError(field, values[field.key]);
    if (message) errors[field.key] = message;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// §8: what an Industrial and General referral must state.
// ---------------------------------------------------------------------------

export const INDUSTRIAL_REFERRAL_STATEMENTS: { key: string; label: string }[] =
  [
    { key: "claim", label: "What the teacher is claiming" },
    { key: "verified", label: "What the province verified" },
    { key: "unresolved", label: "What remains unresolved" },
    { key: "adviceRequired", label: "What decision or advice is required" },
  ];

// ---------------------------------------------------------------------------
// §17 The Golden Rule for Provincial Administration
// "No teacher matter should be received without being registered, no registered
// matter should remain without an assigned action, no referred matter should
// remain without follow up and no matter should be closed without a recorded
// outcome."
// ---------------------------------------------------------------------------

export const GOLDEN_RULE_PARTS: { key: string; text: string }[] = [
  {
    key: "registered",
    text: "No teacher matter received without being registered",
  },
  {
    key: "assigned_action",
    text: "No registered matter without an assigned action",
  },
  { key: "referral_followup", text: "No referred matter without follow-up" },
  {
    key: "recorded_outcome",
    text: "No matter closed without a recorded outcome",
  },
];

// ---------------------------------------------------------------------------
// §17 enforcement
//
// The manual states the rule as a single principle, so the platform enforces it
// as hard invariants on the server rather than as guidance in the UI. Each
// check returns the manual clause it comes from so the officer sees the reason
// for the rejection.
// ---------------------------------------------------------------------------

export type GoldenRuleViolation = { part: string; message: string };

const MIN_OUTCOME_LENGTH = 8;
const MIN_ACTION_LENGTH = 4;

export type GoldenRuleInput = {
  currentStatus: string;
  nextStatus: string;
  actionRequired?: string | null;
  outcome?: string | null;
  dateClosed?: Date | string | null;
  communicatedByName?: string | null;
  /** A matter at these statuses has been referred out and awaits a response. */
  awaitingResponse?: boolean;
  referralResponseDueDate?: Date | string | null;
};

/**
 * Returns the violations that would break the Golden Rule if this status change
 * were applied. An empty array means the change is permitted.
 */
export function checkGoldenRule(input: GoldenRuleInput): GoldenRuleViolation[] {
  const violations: GoldenRuleViolation[] = [];
  const isClosing = input.nextStatus === "CLS" || input.nextStatus === "RES";
  const hasText = (value: string | null | undefined, min: number) =>
    typeof value === "string" && value.trim().length >= min;

  // "no registered matter should remain without an assigned action" - a matter
  // must not progress past intake without the officer stating what is to be done.
  const needsAction = !["NEW", "CLS", "RES"].includes(input.nextStatus);
  if (needsAction && !hasText(input.actionRequired, MIN_ACTION_LENGTH)) {
    violations.push({
      part: "assigned_action",
      message:
        "Golden Rule: no registered matter should remain without an assigned action. Record what action is required before moving beyond 'Newly received'.",
    });
  }

  // "no matter should be closed without a recorded outcome"
  if (isClosing) {
    if (!hasText(input.outcome, MIN_OUTCOME_LENGTH)) {
      violations.push({
        part: "recorded_outcome",
        message:
          "Golden Rule: no matter should be closed without a recorded outcome. Record the decision or advice given.",
      });
    }
    if (!input.dateClosed) {
      violations.push({
        part: "recorded_outcome",
        message: "Golden Rule: record the date closed when closing a matter.",
      });
    }
    if (!hasText(input.communicatedByName, 2)) {
      violations.push({
        part: "recorded_outcome",
        message:
          "Golden Rule: confirm the outcome has been communicated to the teacher and record who communicated it.",
      });
    }
  }

  // "no referred matter should remain without follow up"
  if (input.awaitingResponse && !input.referralResponseDueDate) {
    violations.push({
      part: "referral_followup",
      message:
        "Golden Rule: no referred matter should remain without follow up. Set a response due date so the referral is tracked.",
    });
  }

  return violations;
}
