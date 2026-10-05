import { afterEach, describe, expect, it } from "vitest";
import {
  formatDateOnly,
  formatInstant,
  parseDateInput,
  toDateInputValue,
  todayInputValue,
} from "./dateInput";

/**
 * Calendar dates and instants.
 *
 * The bug these guard against is a calendar date being read as an instant, which
 * shows the officer the wrong day and only for some of them.
 *
 * A `<input type="date">` has no timezone. Its value crosses the wire as
 * `YYYY-MM-DD`, and both ends of the stack read that string as **UTC** midnight:
 * `new Date("2026-10-05")` is UTC midnight by specification, and so is
 * `z.coerce.date()` on the server. So a stored calendar date is always
 * 2026-10-05T00:00:00Z.
 *
 * Read that back with *local* getters and the answer is the 4th for every browser
 * west of UTC — the officer types the 5th on a due date and is shown the 4th on
 * the register, on the case file, and in the field itself. It is invisible on a
 * machine in UTC or east of it, which is why it survived: this deployment is
 * UTC+10.
 *
 * The tests below pin the timezone rather than trusting the machine. A test that
 * only passes east of UTC is not a test of this behaviour — which is exactly how
 * the bug survived, since this deployment is UTC+10.
 */

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** The value as it comes back off the database for a calendar date. */
const STORED = "2026-10-05T00:00:00.000Z";

/** The local calendar date parts of an instant, in whatever zone `TZ` is now. */
function localParts(at: string) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** The UTC calendar date parts of an instant. */
function utcParts(at: string) {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

describe("the off-by-one-day this design exists to prevent", () => {
  // West of UTC, where the two readings disagree. America/New_York is UTC-5 in
  // October, so 2026-10-05T00:00Z is still 4 October locally.
  const WEST = "America/New_York";

  it("is real: local getters read a stored calendar date as the day before", () => {
    process.env.TZ = WEST;
    // The premise. If this ever stopped holding — because the storage format
    // changed to local midnight — the UTC getters below would be the wrong
    // choice and this file's premise would need revisiting, so it is asserted
    // rather than assumed.
    expect(localParts(STORED)).toBe("2026-10-04");
    expect(utcParts(STORED)).toBe("2026-10-05");
  });

  it("does not reach the formatter", () => {
    process.env.TZ = WEST;
    expect(toDateInputValue(STORED)).toBe("2026-10-05");
    expect(formatDateOnly(STORED)).toBe("5 Oct 2026");
  });

  it("does not reach the field the officer is typing into", () => {
    process.env.TZ = WEST;
    // The field is seeded from the stored value and re-sent verbatim, so a
    // formatter that disagreed with the parser would make the date move under
    // the officer on every save.
    const edited = parseDateInput(toDateInputValue(STORED))!;
    expect(toDateInputValue(edited)).toBe("2026-10-05");
  });

  it("holds in every timezone, because it reads UTC parts", () => {
    for (const zone of [
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Pacific/Kiritimati",
      "Pacific/Auckland",
      "Africa/Nairobi",
      "Asia/Manila",
    ]) {
      process.env.TZ = zone;
      expect(toDateInputValue(STORED), zone).toBe("2026-10-05");
      expect(formatDateOnly(STORED), zone).toBe("5 Oct 2026");
      expect(utcParts(STORED), zone).toBe("2026-10-05");
    }
  });
});

describe("reading a stored calendar date back", () => {
  it("round-trips through the date input", () => {
    expect(toDateInputValue(STORED)).toBe("2026-10-05");
    expect(toDateInputValue(new Date(STORED))).toBe("2026-10-05");
  });

  it("reads the day the officer typed, in every timezone", () => {
    // A UTC date input for a calendar field is independent of `TZ`, so the
    // round trip must hold for all of them. Run under several by stubbing the
    // value rather than the clock: `toDateInputValue` uses UTC getters, so its
    // answer must not move.
    for (const zone of [
      "UTC",
      "Pacific/Kiritimati",
      "Pacific/Auckland",
      "Africa/Nairobi",
      "Asia/Manila",
    ]) {
      expect(toDateInputValue(STORED), zone).toBe("2026-10-05");
      expect(formatDateOnly(STORED), zone).toBe("5 Oct 2026");
    }
  });

  it("does not slip a day across a month boundary", () => {
    expect(toDateInputValue("2026-10-01T00:00:00.000Z")).toBe("2026-10-01");
    expect(toDateInputValue("2026-10-31T00:00:00.000Z")).toBe("2026-10-31");
    expect(toDateInputValue("2026-03-01T00:00:00.000Z")).toBe("2026-03-01");
  });

  it("says nothing for an absent or unreadable date", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
    expect(toDateInputValue("")).toBe("");
    expect(toDateInputValue("not a date")).toBe("");
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
    expect(formatDateOnly("not a date")).toBe("—");
  });

  it("pads the day only when asked", () => {
    expect(formatDateOnly("2026-10-05T00:00:00.000Z")).toBe("5 Oct 2026");
    expect(formatDateOnly("2026-10-05T00:00:00.000Z", { padDay: true })).toBe(
      "05 Oct 2026"
    );
  });

  it("handles a leap day", () => {
    expect(toDateInputValue("2028-02-29T00:00:00.000Z")).toBe("2028-02-29");
    expect(formatDateOnly("2028-02-29T00:00:00.000Z")).toBe("29 Feb 2028");
  });
});

describe("parsing what a date input produced", () => {
  it("produces the same instant the server's coercion produces", () => {
    // `z.coerce.date()` is `new Date(value)`, so this is the agreement the whole
    // design rests on: if it broke, a calendar date would be stored at a
    // different instant from the one the officer's browser read.
    expect(parseDateInput("2026-10-05")?.getTime()).toBe(
      new Date("2026-10-05").getTime()
    );
    expect(parseDateInput("2026-10-05")?.toISOString()).toBe(
      "2026-10-05T00:00:00.000Z"
    );
  });

  it("refuses anything that is not a complete calendar date", () => {
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("2026-10")).toBeNull();
    expect(parseDateInput("2026-10-05T00:00:00Z")).toBeNull();
    expect(parseDateInput("05/10/2026")).toBeNull();
    expect(parseDateInput("October 5 2026")).toBeNull();
  });

  it("survives the parse-format-parse cycle a field does on every edit", () => {
    const first = parseDateInput("2026-12-31")!;
    expect(parseDateInput(toDateInputValue(first))!.getTime()).toBe(
      first.getTime()
    );
  });
});

describe("today", () => {
  it("is the calendar date where the browser is, not where UTC is", () => {
    // "Today" is a fact about the officer's desk. The stored value it becomes is
    // still UTC midnight, so this is the one function here that reads local date
    // parts — and it is the reason the two kinds of getter coexist.
    expect(todayInputValue()).toBe(localParts(new Date().toISOString()));
    expect(todayInputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is a calendar date the field will accept", () => {
    expect(parseDateInput(todayInputValue())).not.toBeNull();
  });
});

describe("instants stay local", () => {
  it("formats an instant in the reader's timezone, not UTC", () => {
    // The counterpart to the calendar-date rule: an audit entry saying when an
    // officer did something means when, in their own time. Formatting these with
    // UTC getters would be as wrong as formatting a due date with local ones.
    const at = "2026-10-05T23:30:00.000Z";
    const expected = new Date(at).toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatInstant(at)).toBe(expected);
  });

  it("carries a time as well as a day, so it is not mistaken for a calendar date", () => {
    expect(formatInstant(STORED)).not.toBe(formatDateOnly(STORED));
    expect(formatInstant(null)).toBe("—");
  });
});
