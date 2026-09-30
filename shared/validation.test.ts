import { describe, expect, it } from "vitest";
import {
  dateField,
  emailAddress,
  optionalText,
  pageBounds,
  recordId,
  requiredText,
  searchTerm,
} from "./validation";

/**
 * The words a rejected form submission is answered with.
 *
 * These fields exist so that no rejection anywhere in the API is phrased in
 * terms of the validator. Zod's default for `z.string().min(8)` is "Too small:
 * expected string to have >=8 characters", which describes the check and leaves
 * the reader to work out which box it meant. The rules below are the wording, and
 * the wording is the part that has to be right: a message that names the field
 * and the fix is the difference between an officer correcting one box and an
 * officer guessing.
 */

const messageFor = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? null : result.error?.issues[0]?.message);

describe("requiredText", () => {
  it("names the field when it is empty", () => {
    expect(
      messageFor(requiredText("Teacher's name", { min: 2 }).safeParse(""))
    ).toBe("Teacher's name is required.");
  });

  it("treats whitespace as empty rather than as an answer", () => {
    // Four spaces satisfy a naive length check and store a blank field.
    expect(
      messageFor(requiredText("Teacher's name", { min: 2 }).safeParse("   "))
    ).toBe("Teacher's name is required.");
  });

  it("tells a short answer how short it was, rather than calling it missing", () => {
    // "Required" and "too short" are different instructions. Telling an officer
    // a one-word summary is missing teaches them to pad it to the limit to get
    // past a check they did not understand.
    expect(
      messageFor(
        requiredText("Summary of the matter", { min: 8 }).safeParse("short")
      )
    ).toBe("Summary of the matter must be at least 8 characters.");
  });

  it("states a ceiling as a ceiling", () => {
    expect(
      messageFor(
        requiredText("Full name", { min: 2, max: 160 }).safeParse(
          "x".repeat(200)
        )
      )
    ).toBe("Full name must be 160 characters or fewer.");
  });

  it("passes a trimmed value through", () => {
    const result = requiredText("Full name", { min: 2 }).safeParse(
      "  Jo Kumul  "
    );
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe("Jo Kumul");
  });
});

describe("optionalText", () => {
  it("says nothing when left out", () => {
    expect(optionalText("Note", { max: 500 }).safeParse("").success).toBe(true);
  });

  it("still says so when it is too long", () => {
    // Optional, not unlimited: a note of 4,000 characters is not something to
    // discover by being rejected.
    expect(
      messageFor(optionalText("Note", { max: 500 }).safeParse("x".repeat(600)))
    ).toBe("Note must be 500 characters or fewer.");
  });
});

describe("dateField", () => {
  it("accepts what a date input and an ISO string both produce", () => {
    expect(dateField().safeParse("2026-01-30").success).toBe(true);
    expect(dateField().safeParse(new Date()).success).toBe(true);
  });

  it("rejects anything else in a sentence", () => {
    expect(messageFor(dateField().safeParse("not-a-date"))).toBe(
      "Enter a valid date."
    );
  });
});

describe("recordId", () => {
  it("names the thing being chosen", () => {
    // Reaching this means the interface and the database disagree about which
    // matter was selected, which is a bug rather than a mistake an officer made.
    expect(messageFor(recordId().safeParse(0))).toBe(
      "Choose which matter this applies to."
    );
    expect(messageFor(recordId("officer").safeParse(-1))).toBe(
      "Choose which officer this applies to."
    );
  });

  it("accepts a real id", () => {
    expect(recordId().safeParse(7).success).toBe(true);
  });
});

describe("emailAddress", () => {
  it("shows the shape it wants", () => {
    expect(messageFor(emailAddress().safeParse("joel"))).toBe(
      "Enter email address in the form name@example.com."
    );
  });

  it("accepts an address and refuses an over-long one", () => {
    expect(emailAddress().safeParse("joel@example.com").success).toBe(true);
    expect(
      messageFor(emailAddress().safeParse(`${"x".repeat(320)}@example.com`))
    ).toMatch(/320 characters or fewer/);
  });
});

describe("pageBounds", () => {
  it("states the ceiling the register's own limit sets", () => {
    expect(messageFor(pageBounds(100).limit.safeParse(500))).toBe(
      "Show no more than 100 rows at a time."
    );
  });

  it("refuses a row count of none", () => {
    expect(messageFor(pageBounds(100).limit.safeParse(0))).toBe(
      "Show at least one row."
    );
  });

  it("rejects a page number that is not one", () => {
    expect(messageFor(pageBounds(100).offset.safeParse(-1))).toBe(
      "The page number is not valid."
    );
  });
});

describe("searchTerm", () => {
  it("is optional", () => {
    expect(searchTerm().safeParse(undefined).success).toBe(true);
    expect(searchTerm().safeParse("  Kumul  ").success).toBe(true);
  });

  it("caps the term, because an unbounded one is an expensive question", () => {
    expect(messageFor(searchTerm().safeParse("x".repeat(300)))).toBe(
      "Search must be 200 characters or fewer."
    );
  });
});
