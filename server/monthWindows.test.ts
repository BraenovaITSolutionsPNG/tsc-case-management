import { describe, expect, it } from "vitest";
import { monthWindows } from "./db";

/**
 * The month buckets on the platform statistics screen.
 *
 * These exist as a separate assertion because the arithmetic they cover is the
 * kind that is invisible in the source and obvious in the figures. `getSystemStats`
 * used to build each window with `setDate(1)` and nothing else, which snapped the
 * day but left the time of day in place: every bar became
 * `[1st at the current time, 1st of next month at the current time)`. A matter
 * received at 09:00 on 1 October was therefore counted in the September bar, under
 * the September label — for the first half of every month, on a deployment that
 * runs UTC+10.
 *
 * The tests state the invariant directly: a window is the calendar month, so
 * everything from midnight on the 1st belongs to it, and nothing does until the
 * 1st of the next month.
 */
describe("month windows", () => {
  const inWindow = (
    at: Date | string,
    win: { start: Date; end: Date }
  ): boolean => {
    const t = new Date(at).getTime();
    return t >= win.start.getTime() && t < win.end.getTime();
  };

  it("starts each month at midnight on the 1st, not at the current time of day", () => {
    // 14:33 on the 5th — the case that failed.
    const [, current] = monthWindows(new Date(2026, 9, 5, 14, 33, 21), 2);
    expect(current.key).toBe("2026-10");
    expect(current.start.getHours()).toBe(0);
    expect(current.start.getMinutes()).toBe(0);
    expect(current.start.getSeconds()).toBe(0);
    expect(current.start.getMilliseconds()).toBe(0);
    expect(current.start.getDate()).toBe(1);
  });

  it("puts the whole of the 1st in its own month", () => {
    const windows = monthWindows(new Date(2026, 9, 5, 14, 33, 21), 2);
    const september = windows[0];
    const october = windows[1];

    const firstThingOnTheFirst = new Date(2026, 9, 1, 0, 0, 0);
    const lastMomentOfTheMonthBefore = new Date(2026, 8, 30, 23, 59, 59);

    expect(inWindow(firstThingOnTheFirst, october)).toBe(true);
    expect(inWindow(firstThingOnTheFirst, september)).toBe(false);
    expect(inWindow(lastMomentOfTheMonthBefore, september)).toBe(true);
    expect(inWindow(lastMomentOfTheMonthBefore, october)).toBe(false);
  });

  it("does not carry a month's first hours into the previous month", () => {
    const [september, october] = monthWindows(new Date(2026, 9, 5, 14, 33), 2);
    // Every hour of the 1st, which is where the old boundaries misfiled them.
    for (let hour = 0; hour < 24; hour += 1) {
      const onTheFirst = new Date(2026, 9, 1, hour, 30);
      expect(inWindow(onTheFirst, october)).toBe(true);
      expect(inWindow(onTheFirst, september)).toBe(false);
    }
  });

  it("covers exactly one month and stops at the next midnight", () => {
    const [october] = monthWindows(new Date(2026, 9, 5, 14, 33), 1);
    expect(inWindow(new Date(2026, 9, 31, 23, 59, 59), october)).toBe(true);
    expect(inWindow(new Date(2026, 10, 1, 0, 0, 0), october)).toBe(false);
    expect(inWindow(new Date(2026, 9, 1, 0, 0, 0), october)).toBe(true);
    // August the 31st: month 7 is August, and September has only thirty days, so
    // `new Date(2026, 8, 31)` would silently roll forward into October.
    expect(inWindow(new Date(2026, 7, 31, 23, 59, 59), october)).toBe(false);
  });

  it("runs backwards without repeats, oldest first", () => {
    const keys = monthWindows(new Date(2026, 9, 5), 12).map(w => w.key);
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    expect(keys.at(-1)).toBe("2026-10");
    expect(keys[0]).toBe("2025-11");
    expect([...keys]).toEqual([...keys].sort());
  });

  it("crosses a year boundary without losing or repeating a month", () => {
    const keys = monthWindows(new Date(2026, 0, 15), 4).map(w => w.key);
    expect(keys).toEqual(["2025-10", "2025-11", "2025-12", "2026-01"]);
  });

  it("handles a leap day inside its own February", () => {
    // Month 1 is February. Month 2 would be March, and February 2028 has
    // twenty-nine days, so the window must end on 1 March rather than the 28th.
    const [february] = monthWindows(new Date(2028, 1, 15), 1);
    expect(february.key).toBe("2028-02");
    expect(inWindow(new Date(2028, 1, 29, 12, 0), february)).toBe(true);
    expect(inWindow(new Date(2028, 2, 1, 0, 0), february)).toBe(false);
    expect(february.end.getFullYear()).toBe(2028);
    expect(february.end.getMonth()).toBe(2);
    expect(february.end.getDate()).toBe(1);
  });

  it("abuts each window with the next, leaving no gap and no overlap", () => {
    const windows = monthWindows(new Date(2026, 9, 5), 4);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i].start.getTime()).toBe(windows[i - 1].end.getTime());
    }
  });
});
