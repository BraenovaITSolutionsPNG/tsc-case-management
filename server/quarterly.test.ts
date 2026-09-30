import { describe, expect, it } from "vitest";
import { listQuarters, quarterRange } from "./db";

/**
 * §12E quarter arithmetic. The report is only as trustworthy as its period
 * boundaries, and a boundary that leaks by a day moves matters between quarters
 * silently rather than throwing - so the ranges are pinned directly.
 */
describe("quarter periods", () => {
  it("covers three whole calendar months", () => {
    const cases: [string, string, string, string][] = [
      // key, first day, last day (the day before the exclusive end)
      ["2026-Q1", "2026-01-01", "2026-03-31"],
      ["2026-Q2", "2026-04-01", "2026-06-30"],
      ["2026-Q3", "2026-07-01", "2026-09-30"],
      ["2026-Q4", "2026-10-01", "2026-12-31"],
    ];
    for (const [key, first, lastDay] of cases) {
      const { start, end } = quarterRange(key);
      expect(iso(start)).toBe(first);
      // `end` is exclusive, so the final day of the quarter is the day before.
      expect(iso(new Date(end.getTime() - 86_400_000))).toBe(lastDay);
    }
  });

  it("does not overlap: one quarter's end is the next quarter's start", () => {
    for (const [a, b] of [
      ["2026-Q1", "2026-Q2"],
      ["2026-Q2", "2026-Q3"],
      ["2026-Q3", "2026-Q4"],
      ["2026-Q4", "2027-Q1"],
    ]) {
      expect(quarterRange(b).start.getTime()).toBe(
        quarterRange(a).end.getTime()
      );
    }
  });

  it("rejects a key that is not a quarter", () => {
    // A malformed key must not silently resolve to the current quarter, which
    // would show the Director the wrong period without any error.
    for (const bad of ["2026-13", "Q3", "2026", "", "2026-Q0", "2026-Q5"]) {
      expect(() => quarterRange(bad)).toThrow();
    }
  });

  it("offers the current quarter first, walking backwards without repeats", () => {
    const quarters = listQuarters(4);
    expect(quarters).toHaveLength(4);
    const now = new Date();
    expect(quarters[0].key).toBe(
      `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
    );
    expect(new Set(quarters.map(q => q.key)).size).toBe(4);
    expect(quarters[0].key > quarters[1].key).toBe(true);
  });

  it("labels the quarter it is actually showing", () => {
    const [current] = listQuarters(1);
    const now = new Date();
    expect(current.label).toBe(
      `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
    );
  });
});

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}
