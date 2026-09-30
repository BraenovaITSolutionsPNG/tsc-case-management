import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_RETRIES,
  shouldRetryQuery,
  trpcErrorCode,
} from "./queryClient";

/**
 * The retry policy decides whether a failed query costs one request or several,
 * against routers whose procedures range from "the database was briefly
 * unreachable" to "you are not cleared for that". Getting it wrong in one
 * direction is slow; getting it wrong in the other repeats a refusal.
 */

/** A failure shaped the way tRPC hands one to the client. */
function trpcError(code: string) {
  return { data: { code }, message: `failed with ${code}` };
}

/**
 * A refusal as the procedure itself threw it, which is the shape the server-side
 * prefetch sees. `data` is absent and the code is on the top level.
 */
function serverError(code: string) {
  return { name: "TRPCError", code, message: `failed with ${code}` };
}

describe("trpcErrorCode", () => {
  it("reads the code off a client failure", () => {
    expect(trpcErrorCode(trpcError("UNAUTHORIZED"))).toBe("UNAUTHORIZED");
  });

  it("reads the code off a server failure, which carries it elsewhere", () => {
    // Same refusal, different shape. The prefetch path throws this one.
    expect(trpcErrorCode(serverError("FORBIDDEN"))).toBe("FORBIDDEN");
    expect(trpcErrorCode(serverError("FORBIDDEN")).length).toBeGreaterThan(0);
  });

  it("answers null for a failure that never reached a procedure", () => {
    // A dropped connection is the case the retry is for, and it arrives with no
    // tRPC envelope at all.
    expect(trpcErrorCode(new TypeError("Failed to fetch"))).toBeNull();
  });

  it("answers null for values that are not errors", () => {
    expect(trpcErrorCode(null)).toBeNull();
    expect(trpcErrorCode(undefined)).toBeNull();
    expect(trpcErrorCode("UNAUTHORIZED")).toBeNull();
    expect(trpcErrorCode({ data: null })).toBeNull();
    expect(trpcErrorCode({ data: { code: 401 } })).toBeNull();
  });
});

describe("shouldRetryQuery", () => {
  it("retries a dropped connection, which a repeat request can fix", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
  });

  it("does not retry a refusal, which a repeat request can only repeat", () => {
    // The one this policy exists for: an expired session would otherwise cost
    // four requests per screen on its way to the sign-in page.
    expect(shouldRetryQuery(0, trpcError("UNAUTHORIZED"))).toBe(false);
    expect(shouldRetryQuery(0, trpcError("FORBIDDEN"))).toBe(false);
    expect(shouldRetryQuery(0, trpcError("NOT_FOUND"))).toBe(false);
    expect(shouldRetryQuery(0, trpcError("BAD_REQUEST"))).toBe(false);
  });

  it("does not retry a refusal thrown by the server-side prefetch either", () => {
    // The same refusals in the shape a procedure throws them. Getting this wrong
    // is invisible from the browser, and it re-registers three requests per
    // refused prefetch against a server that has already answered.
    expect(shouldRetryQuery(0, serverError("UNAUTHORIZED"))).toBe(false);
    expect(shouldRetryQuery(0, serverError("FORBIDDEN"))).toBe(false);
    expect(shouldRetryQuery(0, serverError("BAD_REQUEST"))).toBe(false);
  });

  it("retries the failures that mean the request was never answered", () => {
    expect(shouldRetryQuery(0, trpcError("INTERNAL_SERVER_ERROR"))).toBe(true);
    expect(shouldRetryQuery(0, trpcError("SERVICE_UNAVAILABLE"))).toBe(true);
    expect(shouldRetryQuery(0, trpcError("GATEWAY_TIMEOUT"))).toBe(true);
    expect(shouldRetryQuery(0, serverError("INTERNAL_SERVER_ERROR"))).toBe(true);
  });

  it("stops at the attempt limit", () => {
    expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, new Error("nope"))).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, new Error("nope"))).toBe(false);
  });

  it("does not retry a code it has never heard of", () => {
    // A procedure that starts answering with a new code should be retried only
    // on purpose, not by inheriting the network-failure behaviour.
    expect(shouldRetryQuery(0, trpcError("LEGACY_QUARTER_CLOSED"))).toBe(false);
  });
});
