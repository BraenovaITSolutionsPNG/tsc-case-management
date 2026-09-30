import { describe, expect, it } from "vitest";
import {
  OVERSIGHT_PAGE_SIZE,
  REGISTER_PAGE_SIZE,
  clampPage,
  offsetFor,
  pageCount,
  pageForOffset,
} from "./pagination";

/**
 * These are the only numbers in the register that are not a count of matters,
 * and they are the ones a filter change can invalidate. An officer three pages
 * into a register who types a search should land back on page 1 with the matches
 * they asked for, not on an empty table.
 */

describe("pageCount", () => {
  it("rounds up, so a part-full last page still counts", () => {
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(24, 25)).toBe(1);
  });

  it("reports one page for an empty register rather than none", () => {
    // A "page 1 of 0" is the failure this floor exists to prevent.
    expect(pageCount(0, 25)).toBe(1);
  });

  it("survives a page size of zero", () => {
    expect(pageCount(10, 0)).toBe(1);
  });
});

describe("clampPage", () => {
  it("leaves a page that exists alone", () => {
    expect(clampPage(1, 100, 25)).toBe(1);
    expect(clampPage(3, 100, 25)).toBe(3);
    expect(clampPage(4, 100, 25)).toBe(4);
  });

  it("pulls a page past the end back to the last one with rows", () => {
    // The case that actually happens: the filters narrow under the officer.
    expect(clampPage(4, 60, 25)).toBe(3);
  });

  it("sends a page below the start back to the first", () => {
    expect(clampPage(0, 100, 25)).toBe(1);
    expect(clampPage(-2, 100, 25)).toBe(1);
  });

  it("settles on page 1 for an empty register", () => {
    expect(clampPage(3, 0, 25)).toBe(1);
  });

  it("truncates a fractional page rather than producing a fractional offset", () => {
    expect(clampPage(2.7, 100, 25)).toBe(2);
  });

  it("does not pass a page it cannot make sense of through to the caller", () => {
    expect(clampPage(Number.NaN, 100, 25)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 100, 25)).toBe(4);
  });
});

describe("offsetFor", () => {
  it("counts pages from one, so the first page reads nothing", () => {
    expect(offsetFor(1, 25)).toBe(0);
    expect(offsetFor(2, 25)).toBe(25);
    expect(offsetFor(3, 25)).toBe(50);
  });

  it("never produces a negative offset", () => {
    expect(offsetFor(0, 25)).toBe(0);
    expect(offsetFor(-1, 25)).toBe(0);
  });
});

describe("pageForOffset", () => {
  it("is the inverse of offsetFor across a range", () => {
    for (let page = 1; page <= 8; page += 1) {
      expect(pageForOffset(offsetFor(page, REGISTER_PAGE_SIZE), REGISTER_PAGE_SIZE)).toBe(
        page
      );
    }
  });

  it("reads the page an offset belongs to", () => {
    expect(pageForOffset(0, 25)).toBe(1);
    expect(pageForOffset(24, 25)).toBe(1);
    expect(pageForOffset(25, 25)).toBe(2);
  });
});

describe("the page sizes", () => {
  it("are positive, so neither can produce a zero-page register", () => {
    expect(REGISTER_PAGE_SIZE).toBeGreaterThan(0);
    expect(OVERSIGHT_PAGE_SIZE).toBeGreaterThan(0);
  });
});
