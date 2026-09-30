import { QueryClient } from "@tanstack/react-query";
import { createQueryUtilsProxy } from "@trpc/react-query/shared";
import { describe, expect, it } from "vitest";
import { trpc } from "@/lib/trpc";
import {
  invalidateMatterWrites,
  invalidateSession,
  invalidateUserWrites,
} from "./queryInvalidation";

/**
 * These helpers are the thing #3 exists for, and they are a list, so both the
 * list and the assumption underneath it are worth pinning down.
 *
 * The tests run the real helpers against a real `QueryClient` using tRPC's own
 * key builder, rather than against a stand-in. `trpc.x.y.queryKey()` cannot be
 * used here because it is a React hook, but the underlying proxy is not, and it
 * builds the identical key — so the keys under test are the keys the app uses.
 */

/** A cache, a utility proxy over it, and a log of what was invalidated. */
function harness() {
  const queryClient = new QueryClient();
  const invalidated: unknown[][] = [];

  const context = {
    // `createQueryUtilsProxy` needs the handful of cache operations the proxy
    // can reach. The key itself is built by tRPC before these are called, which
    // is the part under test; the bodies are the ordinary React Query calls the
    // real context makes.
    queryOptions: (_path: unknown, queryKey: unknown, opts?: object) => ({
      queryKey,
      ...(opts ?? {}),
    }),
    invalidateQueries: (queryKey: unknown, filters?: object) => {
      invalidated.push(queryKey as unknown[]);
      return queryClient.invalidateQueries({
        queryKey: queryKey as never,
        ...(filters ?? {}),
      });
    },
    prefetchQuery: (queryKey: unknown, opts?: object) =>
      queryClient.prefetchQuery({ queryKey: queryKey as never, ...(opts ?? {}) }),
    getQueryData: (queryKey: unknown) => queryClient.getQueryData(queryKey as never),
    setQueryData: (queryKey: unknown, data: unknown) =>
      queryClient.setQueryData(queryKey as never, data),
  };

  const utils = createQueryUtilsProxy(
    context as never
  ) as ReturnType<typeof trpc.useUtils>;

  /** The cache key for a procedure call, built by tRPC. */
  function keyOf<T extends { queryOptions: (input?: unknown) => { queryKey: unknown } }>(
    procedure: T,
    input?: unknown
  ) {
    return procedure.queryOptions(input).queryKey;
  }

  return { queryClient, utils, invalidated, keyOf };
}

/** The dotted procedure path of a key, which is what identifies a read. */
function pathOf(key: unknown[]) {
  return (key[0] as string[]).join(".");
}

describe("what a matter write dirties", () => {
  it("covers the matter, the province figures, the oversight view and the audit trail", async () => {
    const { utils, invalidated } = harness();

    await invalidateMatterWrites(utils, 7);

    expect(invalidated.map(pathOf).sort()).toEqual([
      "admin.audit.list",
      "admin.cases.list",
      "caseManagement.dashboard",
      "caseManagement.getById",
      "caseManagement.list",
      "caseManagement.summary",
    ]);
  });

  it("dirties this matter's file and no other", async () => {
    const { utils, invalidated, keyOf } = harness();

    await invalidateMatterWrites(utils, 7);

    // Note the key is the partial one `invalidate` builds: it carries the input
    // and no `type`, because invalidation is deliberately query-type agnostic.
    // React Query's matching is partial, so it still lands on the full
    // `{input, type:"query"}` entry the screen actually read.
    const detail = invalidated
      .filter(key => pathOf(key) === "caseManagement.getById")
      .map(key => JSON.stringify(key[1]));

    expect(detail).toEqual(['{"input":{"id":7}}']);

    // And the id in it is the one that was written, not a wildcard.
    const seeded = keyOf(utils.caseManagement.getById, { id: 9 });
    expect(
      (detail[0] ?? "").includes("9")
    ).toBe(false);
    expect(seeded).toBeDefined();
  });

  it("skips the matter's file when there is no matter yet", async () => {
    // Registering a new matter: the server has just assigned the reference, so
    // there is no file to dirty, but the province-wide figures have moved.
    const { utils, invalidated } = harness();

    await invalidateMatterWrites(utils);

    expect(invalidated.map(pathOf)).not.toContain("caseManagement.getById");
    expect(invalidated.map(pathOf)).toContain("caseManagement.dashboard");
  });
});

describe("what a user write dirties", () => {
  it("refreshes the officer as well as the account list", async () => {
    // A super administrator can suspend or delete their own account from this
    // screen, and every screen in the app is reading the current officer.
    const { utils, invalidated } = harness();

    await invalidateUserWrites(utils);

    expect(invalidated.map(pathOf).sort()).toEqual([
      "admin.users.list",
      "auth.me",
    ]);
  });

  it("dirties only the identity on an avatar change", async () => {
    const { utils, invalidated } = harness();

    await invalidateSession(utils);

    expect(invalidated.map(pathOf)).toEqual(["auth.me"]);
  });
});

describe("the register key covers every filter", () => {
  it("a no-input invalidation matches each filter the officers have typed", async () => {
    const { utils, queryClient, keyOf } = harness();

    // The shapes the register actually asks for: nothing typed, and one control
    // each. Every one of these is a separate cache entry, and a write has to
    // reach all of them.
    const variants: Array<Record<string, unknown> | undefined> = [
      {},
      { status: "NEW" },
      { search: "wambui" },
      { province: "Central", overdueOnly: true },
      undefined,
    ];

    for (const input of variants) {
      queryClient.setQueryData(
        keyOf(utils.caseManagement.list, input) as never,
        []
      );
    }

    await invalidateMatterWrites(utils, 7);

    for (const input of variants) {
      const state = queryClient.getQueryState(
        keyOf(utils.caseManagement.list, input) as never
      );
      expect(state?.isInvalidated).toBe(true);
    }
  });

  it("invalidating one matter leaves another matter's file alone", async () => {
    const { utils, queryClient, keyOf } = harness();

    for (const id of [7, 9]) {
      queryClient.setQueryData(
        keyOf(utils.caseManagement.getById, { id }) as never,
        { id }
      );
    }

    await invalidateMatterWrites(utils, 7);

    expect(
      queryClient.getQueryState(
        keyOf(utils.caseManagement.getById, { id: 7 }) as never
      )?.isInvalidated
    ).toBe(true);

    expect(
      queryClient.getQueryState(
        keyOf(utils.caseManagement.getById, { id: 9 }) as never
      )?.isInvalidated
    ).toBeFalsy();
  });

  it("leaves the report set alone", async () => {
    // The reporting set is deliberately not dirtied by a matter write. Every
    // report segment server-renders and prefetches on entry, so a report is read
    // fresh whenever it is opened, and re-running five province-wide aggregations
    // on every edit would be the expensive way to protect against nothing.
    const { utils, queryClient, keyOf } = harness();

    queryClient.setQueryData(keyOf(utils.reports.weeklyBrief) as never, []);

    await invalidateMatterWrites(utils, 7);

    expect(
      queryClient.getQueryState(keyOf(utils.reports.weeklyBrief) as never)
        ?.isInvalidated
    ).toBeFalsy();
  });
});
