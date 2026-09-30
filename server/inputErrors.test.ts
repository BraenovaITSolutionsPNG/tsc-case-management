import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "./_core/env";
import {
  CASE_BRIEF_FIELDS,
  CASE_BRIEF_MIN_LENGTH,
  caseBriefFieldError,
} from "../shared/delegation";
import { formatInputError } from "./_core/trpc";

/**
 * What a rejected input looks like to a client.
 *
 * tRPC hands a validation failure the validator's error object as the cause and
 * copies its `message` into the response — for Zod, a JSON document listing
 * every issue with its origin, code, limit and path. That string is what a
 * browser puts in a toast, so it is not a debugging detail: it is the interface.
 *
 * These exercise the formatter directly because `createCaller` throws before any
 * response is shaped, so the only way to see what a client receives is to call
 * it on its own.
 */

const shape = () => ({
  message: "",
  code: -1,
  data: { code: "BAD_REQUEST" as const, httpStatus: 400 },
});

/** The error tRPC builds when a schema rejects its input. */
function rejected(issues: { path?: unknown[]; message?: string }[]) {
  return new TRPCError({
    code: "BAD_REQUEST",
    cause: Object.assign(new Error("schema failed"), { issues }),
  });
}

describe("input error formatting", () => {
  it("replaces the validator's report with a sentence", () => {
    // The default message is the issues array as JSON: origin, code, minimum,
    // path. It names fields by their wire path and tells an officer nothing.
    const formatted = formatInputError({
      shape: shape(),
      error: rejected([
        {
          path: ["issueRequiringDecision"],
          message: "Issue requiring decision is required.",
        },
        { path: ["recommendation"], message: "Recommendation is required." },
      ]),
    });

    expect(formatted.message).toBe(
      "Issue requiring decision is required. Recommendation is required."
    );
  });

  it("groups the issues by field for a form to render", () => {
    const formatted = formatInputError({
      shape: shape(),
      error: rejected([
        { path: ["issueRequiringDecision"], message: "Too short." },
        { path: ["issueRequiringDecision"], message: "Also too short." },
      ]),
    });

    const data = formatted.data as {
      zodError: { formErrors: string[]; fieldErrors: Record<string, string[]> };
    };
    expect(data.zodError.fieldErrors).toEqual({
      issueRequiringDecision: ["Too short.", "Also too short."],
    });
    expect(data.zodError.formErrors).toEqual([]);
  });

  it("joins a nested path so a field inside an object is still addressable", () => {
    const formatted = formatInputError({
      shape: shape(),
      error: rejected([{ path: ["teacher", "name"], message: "Required." }]),
    });
    const data = formatted.data as {
      zodError: { fieldErrors: Record<string, string[]> };
    };
    expect(data.zodError.fieldErrors).toEqual({
      "teacher.name": ["Required."],
    });
  });

  it("keeps an issue with no path in the message but out of the field list", () => {
    const formatted = formatInputError({
      shape: shape(),
      error: rejected([{ message: "The form is inconsistent." }]),
    });
    const data = formatted.data as {
      zodError: { fieldErrors: Record<string, string[]> };
    };
    expect(formatted.message).toBe("The form is inconsistent.");
    expect(data.zodError.fieldErrors).toEqual({});
  });

  it("leaves a refusal untouched", () => {
    // Guards throw messages written for a person, and `providers.tsx` matches
    // one of them by string. Restating those would be the change in this file
    // that could break a message other code depends on.
    const refusal = new TRPCError({
      code: "FORBIDDEN",
      message: "Not allowed.",
    });
    const original = shape();
    expect(formatInputError({ shape: original, error: refusal })).toBe(
      original
    );
  });

  it("leaves an error that carries no issues untouched", () => {
    const badRequest = new TRPCError({ code: "BAD_REQUEST", message: "Bad." });
    const original = shape();
    expect(formatInputError({ shape: original, error: badRequest })).toBe(
      original
    );
  });

  it("preserves what the shape already carried", () => {
    const original = {
      ...shape(),
      data: {
        ...shape().data,
        path: "caseManagement.saveBrief",
        stack: "at x",
      },
    };
    const formatted = formatInputError({
      shape: original,
      error: rejected([{ path: ["issue"], message: "Issue is required." }]),
    });
    expect(formatted.data.path).toBe("caseManagement.saveBrief");
    expect(formatted.data.stack).toBe("at x");
    expect(formatted.code).toBe(original.code);
  });
});

describe("a real rejected input, end to end", () => {
  /**
   * The two halves of the fix meeting: a schema written the way the router
   * writes its brief sections, and the formatter that restates what it rejects.
   *
   * The tests above check the formatter against issues it was handed, which
   * proves nothing about whether a real Zod error carries the shape it expects.
   * This one parses a real schema and asserts what a client would receive.
   */
  const field = (key: string) =>
    CASE_BRIEF_FIELDS.find(item => item.key === key)!;

  // The same construction the router uses, so this checks the real wiring rather
  // than a fixture that happens to agree with it: the message is chosen per
  // failure from the shared helper, which is what makes a blank section read as
  // blank rather than as "too short".
  const section = (key: string) =>
    z
      .string()
      .trim()
      .min(CASE_BRIEF_MIN_LENGTH, {
        error: issue =>
          caseBriefFieldError(
            field(key),
            typeof issue.input === "string" ? issue.input : ""
          ) ?? "This section is required.",
      });

  const brief = z.object({
    issue: section("issue"),
    issueRequiringDecision: section("issueRequiringDecision"),
    recommendation: section("recommendation"),
  });

  async function rejectionOf(input: unknown) {
    const result = await brief.safeParseAsync(input);
    expect(result.success).toBe(false);
    return formatInputError({
      shape: shape(),
      error: new TRPCError({ code: "BAD_REQUEST", cause: result.error }),
    });
  }

  it("reaches the client as sentences, not as a schema report", async () => {
    const formatted = await rejectionOf({
      issue: "An issue for the Director",
      issueRequiringDecision: "",
      recommendation: "",
    });

    expect(formatted.message).toBe(
      "Issue requiring decision is required. Recommendation is required."
    );
    expect(formatted.message).not.toMatch(/too_small|origin|minimum/);
  });

  it("groups the same sentences by field for the form to place", async () => {
    const formatted = await rejectionOf({
      issue: "",
      issueRequiringDecision: "no",
      recommendation: "",
    });
    const data = formatted.data as {
      zodError: { fieldErrors: Record<string, string[]> };
    };

    expect(data.zodError.fieldErrors).toEqual({
      issue: ["Issue is required."],
      issueRequiringDecision: [
        "Write at least 4 characters in issue requiring decision.",
      ],
      recommendation: ["Recommendation is required."],
    });
  });

  it("names a padding-only section as blank", async () => {
    // Trimmed before it is measured, so four spaces read as missing rather than
    // as the shortest possible brief.
    const result = await brief.safeParseAsync({
      issue: "An issue for the Director",
      issueRequiringDecision: "What needs deciding",
      recommendation: "    ",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Recommendation is required."
    );
  });
});

describe("an unexpected failure in production", () => {
  const internal = () =>
    new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new Error("ER_DUP_ENTRY: Duplicate entry 'x' for key 'PRIMARY'"),
    });

  it("does not ship the internals' own message to the browser", () => {
    // A driver's error text describes the schema to anyone who asks. It is
    // written for the log, not for the person whose save failed.
    const previous = ENV.isProduction;
    Object.defineProperty(ENV, "isProduction", {
      value: true,
      configurable: true,
    });
    try {
      const original = {
        ...shape(),
        message: "ER_DUP_ENTRY: Duplicate entry 'x' for key 'PRIMARY'",
        data: {
          code: "INTERNAL_SERVER_ERROR" as const,
          httpStatus: 500,
          stack: "at x",
        },
      };
      const formatted = formatInputError({
        shape: original,
        error: internal(),
      });

      expect(formatted.message).not.toMatch(
        /ER_DUP_ENTRY|Duplicate entry|PRIMARY/
      );
      expect(formatted.message).toMatch(/went wrong on the server/i);
      expect(formatted.data.stack).toBeUndefined();
    } finally {
      Object.defineProperty(ENV, "isProduction", {
        value: previous,
        configurable: true,
      });
    }
  });

  it("passes the message through in development", () => {
    // The person reading it in development is the developer who wants the stack.
    const previous = ENV.isProduction;
    Object.defineProperty(ENV, "isProduction", {
      value: false,
      configurable: true,
    });
    try {
      const original = { ...shape(), message: "ER_DUP_ENTRY: duplicate" };
      expect(
        formatInputError({ shape: original, error: internal() }).message
      ).toBe("ER_DUP_ENTRY: duplicate");
    } finally {
      Object.defineProperty(ENV, "isProduction", {
        value: previous,
        configurable: true,
      });
    }
  });
});
