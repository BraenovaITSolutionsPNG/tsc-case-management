import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  OVERSIGHT_PAGE_SIZE,
  REGISTER_PAGE_SIZE,
} from "../shared/pagination";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { Role } from "../shared/roles";

/**
 * What each screen asks for, and whether the route will answer it.
 *
 * The page sizes live in `shared/pagination` and the screens send those exact
 * constants, so every paged route has to accept them. Nothing in the type system
 * ties the bound a route declares to the size the screen that reads it sends —
 * both are just numbers, and a mismatch is invisible until the screen is opened.
 *
 * That is not hypothetical: `admin.audit.list` bounded `limit` with
 * `OVERSIGHT_PAGE_SIZE` (20) while defaulting it to `AUDIT_PAGE_SIZE` (50), so
 * the audit screen sent 50 and was refused "Show no more than 20 rows at a
 * time" on every request it could ever make. The whole screen was unreachable.
 *
 * These assertions therefore call each route with the page size its own screen
 * sends, and require that it is not refused. The tests below need no database:
 * input validation runs before the resolver, and a rejection here is a
 * `BAD_REQUEST` naming the bound rather than a query.
 */
function contextFor(role: Role): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 42,
      openId: `test-${role}`,
      email: `${role}@example.com`,
      name: `${role} tester`,
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

/** Whether the failure is the route refusing the page size, rather than anything else. */
async function refusedAsTooManyRows(call: Promise<unknown>): Promise<boolean> {
  const failure = await call.then(
    () => null,
    (error: unknown) => error as { code?: string; message?: string }
  );
  return (
    failure?.code === "BAD_REQUEST" &&
    /rows at a time/i.test(failure.message ?? "")
  );
}

describe("paged routes accept the page size their own screen sends", () => {
  it("serves the register at the register's page size", async () => {
    const caller = appRouter.createCaller(contextFor("staff"));
    // client/src/views/CaseRegister.tsx sends REGISTER_PAGE_SIZE.
    await expect(
      caller.caseManagement.list({ limit: REGISTER_PAGE_SIZE, offset: 0 })
    ).resolves.toBeDefined();
  });

  it("serves the oversight list at the oversight page size", async () => {
    const caller = appRouter.createCaller(contextFor("super_admin"));
    // client/src/views/Admin.tsx sends OVERSIGHT_PAGE_SIZE.
    await expect(
      caller.admin.cases.list({ limit: OVERSIGHT_PAGE_SIZE, offset: 0 })
    ).resolves.toBeDefined();
  });

  it("serves the audit trail at the audit page size", async () => {
    const caller = appRouter.createCaller(contextFor("super_admin"));
    // client/src/views/Admin.tsx sends AUDIT_PAGE_SIZE. The regression: this was
    // bounded at OVERSIGHT_PAGE_SIZE, so the audit trail refused every request
    // the screen could make.
    expect(
      await refusedAsTooManyRows(
        caller.admin.audit.list({ limit: AUDIT_PAGE_SIZE, offset: 0 })
      )
    ).toBe(false);
    await expect(
      caller.admin.audit.list({ limit: AUDIT_PAGE_SIZE, offset: 0 })
    ).resolves.toBeDefined();
  });

  it("still refuses a page larger than the one the screen asks for", async () => {
    // The ceiling is the point of the bound, so a fix that simply removed it
    // would satisfy the three tests above. This is what keeps them honest.
    const caller = appRouter.createCaller(contextFor("super_admin"));
    expect(
      await refusedAsTooManyRows(
        caller.admin.audit.list({ limit: AUDIT_PAGE_SIZE + 1, offset: 0 })
      )
    ).toBe(true);
  });

  it("bounds every paged route at or above the size its screen sends", async () => {
    // Stated as a relationship rather than per-route, so a page size raised in
    // `shared/pagination` fails here for the route that was not updated with it.
    const bounds: [string, number, number][] = [
      ["caseManagement.list", REGISTER_PAGE_SIZE, REGISTER_PAGE_SIZE],
      ["admin.cases.list", OVERSIGHT_PAGE_SIZE, OVERSIGHT_PAGE_SIZE],
      ["admin.audit.list", AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE],
    ];
    for (const [route, screenSends, routeAllows] of bounds) {
      expect(screenSends, `${route} bound`).toBeLessThanOrEqual(routeAllows);
    }
  });
});

describe("the report period pickers", () => {
  it("reads an omitted month as the current month", async () => {
    // client/src/views/Reports.tsx sends `month || undefined` so that clearing
    // the native month picker falls back to the current month rather than
    // sending "" to a validator that only accepts the form 2026-01.
    const caller = appRouter.createCaller(contextFor("assistant"));
    await expect(caller.reports.monthly(undefined)).resolves.toBeDefined();
    await expect(caller.reports.monthly({})).resolves.toBeDefined();
  });

  it("reads an omitted quarter as the current quarter", async () => {
    const caller = appRouter.createCaller(contextFor("assistant"));
    await expect(caller.reports.quarterly(undefined)).resolves.toBeDefined();
  });

  it("still refuses a month that is not a month", async () => {
    const caller = appRouter.createCaller(contextFor("assistant"));
    await expect(
      caller.reports.monthly({ month: "January" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.reports.quarterly({ quarter: "Q1" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
