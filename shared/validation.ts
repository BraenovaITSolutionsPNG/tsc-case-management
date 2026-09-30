import { z } from "zod";

/**
 * Input fields, worded for the person filling them in.
 *
 * Every rejection a form can provoke is written here once, as a sentence naming
 * the field and what to do about it. The alternative is what this module
 * replaces: `z.string().min(8)` answers "Too small: expected string to have
 * >=8 characters", which describes the validator's internals and leaves the
 * officer to work out which of the eleven boxes on the register form it meant.
 *
 * The wording rules, so the same mistake is always phrased the same way:
 *
 * - Missing is not the same as wrong. An empty field is "X is required"; a field
 *   with three characters in it is told how many it wants. Collapsing the two
 *   teaches officers to type the minimum rather than to answer the question.
 * - The label is the label on the form, not the key on the wire, because the
 *   person reading the message is looking at the form.
 * - A limit is stated as a limit. "500 characters or fewer" rather than "invalid
 *   input", so a note that is too long says which way to shorten it.
 *
 * Nothing here decides *whether* a value is acceptable — only how a refusal is
 * phrased. The rules themselves still live with the procedure that owns them.
 */

type Bounds = { min?: number; max?: number };

function tooShort(label: string, min: number) {
  return `${label} must be at least ${min} characters.`;
}

function tooLong(label: string, max: number) {
  return `${label} must be ${max} characters or fewer.`;
}

/**
 * A field the form will not submit without.
 *
 * `min` is the floor below which the entry is blank rather than short — usually
 * 2 for a name, 8 for something meant to be a sentence. It is not a claim about
 * how long the answer ought to be.
 */
export function requiredText(label: string, { min = 1, max }: Bounds = {}) {
  let field = z
    .string()
    .trim()
    .min(min, {
      error: issue =>
        typeof issue.input === "string" && issue.input.trim() === ""
          ? `${label} is required.`
          : tooShort(label, min),
    });
  if (max !== undefined) {
    field = field.max(max, { error: tooLong(label, max) });
  }
  return field;
}

/**
 * A field that may be left out.
 *
 * A maximum still needs saying: a note is optional, but a note of 4,000
 * characters is not something to discover by being rejected.
 */
export function optionalText(label: string, { max }: Bounds = {}) {
  let field = z.string().trim();
  if (max !== undefined) {
    field = field.max(max, { error: tooLong(label, max) });
  }
  return field;
}

/**
 * A date the officer typed, from a date input or an ISO string.
 *
 * The message does not name the field. Every date on a matter is unambiguous
 * from the control the officer is looking at — a date input either shows a date
 * or does not — and the alternative, "Enter date received as a date", reads
 * worse than the message it replaces.
 */
export function dateField() {
  return z.coerce.date({ error: "Enter a valid date." });
}

/**
 * A record reference from the interface.
 *
 * Reaching this with a zero or a negative number means the interface and the
 * database disagree about which matter was selected, which is a bug rather than
 * a mistake an officer made — so the message says so instead of telling them to
 * pick another one.
 */
export function recordId(label = "matter") {
  return z
    .number({ error: `Choose which ${label} this applies to.` })
    .int({ error: `Choose which ${label} this applies to.` })
    .positive({ error: `Choose which ${label} this applies to.` });
}

/** An email address, checked for shape as well as length. */
export function emailAddress(label = "Email address") {
  return z
    .string()
    .trim()
    .max(320, { error: tooLong(label, 320) })
    .email({
      error: `Enter ${label.toLowerCase()} in the form name@example.com.`,
    });
}

/** A page of results. The bounds come from `shared/pagination`. */
export function pageBounds(limit: number) {
  return {
    limit: z
      .number({ error: "Choose how many rows to show." })
      .int({ error: "Choose how many rows to show." })
      .min(1, { error: "Show at least one row." })
      .max(limit, { error: `Show no more than ${limit} rows at a time.` })
      .optional(),
    offset: z
      .number({ error: "The page number is not valid." })
      .int({ error: "The page number is not valid." })
      .min(0, { error: "The page number is not valid." })
      .optional(),
  };
}

/**
 * A search box.
 *
 * Optional, and capped: an unbounded search term is a way to ask the database
 * for a very expensive answer, and the register's own limit is the honest place
 * to stop it.
 */
export function searchTerm(label = "Search") {
  return z
    .string()
    .trim()
    .max(200, { error: tooLong(label, 200) })
    .optional();
}
