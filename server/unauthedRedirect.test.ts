import { describe, expect, it } from "vitest";

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { isUnauthenticatedError } from "@shared/unauthed";

/**
 * The expired-session redirect, and the exact string it depends on.
 *
 * When a session lapses, `protectedProcedure` throws `UNAUTHORIZED` carrying
 * `UNAUTHED_ERR_MSG`, and `app/providers.tsx` compares the message it receives
 * against that same constant in order to send the officer to the sign-in screen.
 * The two are in different processes and the check is equality, so this is the
 * narrowest seam in the platform: any change to one side that is not the other
 * turns quietly into "an officer whose session expired stays on a broken screen
 * and is never asked to sign in again", with nothing failing and nothing in a
 * log.
 *
 * So both halves are asserted here — that the server throws precisely the agreed
 * text, and that the predicate recognises that text and refuses the lookalikes
 * it must not fire on.
 */

/** An anonymous caller, which is what a lapsed session looks like to the server. */
function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

/** The role and now, for the capability checks that need an identity. */
function authenticatedContext(role: "staff" | "super_admin"): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 42,
      openId: "test-1",
      email: "tester@example.com",
      name: "Test Officer",
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    } as NonNullable<TrpcContext["user"]>,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("an expired session", () => {
  it("is refused with exactly the message the client matches on", async () => {
    // Equality, so this asserts identity of the string and not merely that
    // something UNAUTHORIZED-looking was thrown.
    const caller = appRouter.createCaller(anonymousContext());

    const failure = await caller.auth.sessions().then(
      () => null,
      (error: unknown) => error as { code?: string; message?: string }
    );

    expect(failure?.code).toBe("UNAUTHORIZED");
    expect(failure?.message).toBe(UNAUTHED_ERR_MSG);
  });

  it("is recognised by the predicate the provider uses", async () => {
    // The end of the seam: a refusal the server actually produces, through the
    // same function `redirectToLoginIfUnauthorized` calls.
    const caller = appRouter.createCaller(anonymousContext());

    const failure = await caller.auth.sessions().then(
      () => null,
      (error: unknown) => error
    );

    expect(isUnauthenticatedError(failure)).toBe(true);
  });
});

describe("what the expired-session check must not fire on", () => {
  it("ignores a capability refusal", () => {
    // A signed-in officer without a capability is not signed out. Treating this
    // as an expiry would eject somebody mid-task over a permission, and would
    // make a role change look like a lost session.
    expect(isUnauthenticatedError({ message: NOT_ADMIN_ERR_MSG })).toBe(false);
  });

  it("ignores a server fault", () => {
    expect(
      isUnauthenticatedError({
        message: "The platform cannot reach its database",
      })
    ).toBe(false);
  });

  it("ignores a message that merely quotes the expired-session text", () => {
    // The exact reason the comparison is equality rather than `includes`. A
    // substring match here would sign an officer out over any message that
    // happens to contain the phrase.
    expect(
      isUnauthenticatedError({
        message: `${UNAUTHED_ERR_MSG} (requires Director)`,
      })
    ).toBe(false);
  });

  it("ignores values that are not shaped like an error", async () => {
    for (const value of [null, undefined, "Please login (10001)", 42, {}]) {
      expect(isUnauthenticatedError(value)).toBe(false);
    }
  });

  it("still recognises the real thing after all of that", () => {
    // The counterpart to each of the above, so the exclusions cannot be
    // satisfied by a predicate that simply always answers false.
    expect(isUnauthenticatedError({ message: UNAUTHED_ERR_MSG })).toBe(true);
  });
});

describe("a signed-in officer", () => {
  it("is not treated as expired", async () => {
    const caller = appRouter.createCaller(authenticatedContext("super_admin"));

    await expect(caller.auth.sessions()).resolves.toBeDefined();
    expect(isUnauthenticatedError(null)).toBe(false);
  });
});
