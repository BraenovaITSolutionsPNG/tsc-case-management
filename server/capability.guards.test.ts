import { describe, expect, it } from "vitest";
import { can } from "../shared/access";
import type { Role } from "../shared/roles";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * The capability model is only a boundary if the general procedures respect the
 * capabilities of the specific ones. `caseManagement.update` accepts fields that
 * `matter:flag`, `matter:escalate` and `matter:decide` govern, and each of those
 * has a dedicated procedure of its own — so the question these tests ask is
 * whether the dedicated procedures are reachable or merely decorative.
 *
 * No database is involved: every refusal here depends only on the caller's role
 * and the request, so it is decided before the matter is read. That is the
 * property being asserted, and it is why these run without a connection.
 */

type TestUser = NonNullable<TrpcContext["user"]>;

function contextFor(role: Role): TrpcContext {
  const now = new Date();
  const user: TestUser = {
    id: 42,
    openId: `test-${role}`,
    email: `${role}@example.com`,
    name: `${role} tester`,
    loginMethod: "test",
    role,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("matter:flag cannot be set through the general update", () => {
  it("refuses a staff officer who sets the Director's flag directly", async () => {
    // `staff` holds matter:update, so the procedure itself is open to them. The
    // flag is the PA's instrument under §12B and they do not hold matter:flag,
    // which is exactly the case that made `flagForDirector` bypassable.
    expect(can("staff", "matter:update")).toBe(true);
    expect(can("staff", "matter:flag")).toBe(false);

    const caller = appRouter.createCaller(contextFor("staff"));
    await expect(
      caller.caseManagement.update({ id: 1, decisionRequired: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("names the capability it refused, not a bare error", async () => {
    const caller = appRouter.createCaller(contextFor("staff"));
    await expect(
      caller.caseManagement.update({ id: 1, decisionRequired: true })
    ).rejects.toThrow(/flag a matter for the director's attention/i);
  });

  it("lets the tiers that hold matter:flag past the guard", async () => {
    // The guard must not refuse the roles it is written for. An assistant is the
    // tier §12B names, so it gets past the capability check and fails later, on
    // the database — which is the proof that the guard itself let it through.
    const caller = appRouter.createCaller(contextFor("assistant"));
    await expect(
      caller.caseManagement.update({ id: 1, decisionRequired: true })
    ).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("matter:decide cannot be written through the general update", () => {
  it("refuses an assistant who records a decision directly", async () => {
    // §6/§12D make the decision the Director's, and the Assistant tier is
    // deliberately built without matter:decide. `update` accepted decidedByName
    // and status, so the decision could be written by a tier the policy excludes.
    expect(can("assistant", "matter:update")).toBe(true);
    expect(can("assistant", "matter:decide")).toBe(false);

    const caller = appRouter.createCaller(contextFor("assistant"));
    await expect(
      caller.caseManagement.update({
        id: 1,
        decidedByName: "A Director",
        outcome: "A decision recorded here",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("leaves the general fields open to the tier that can use them", async () => {
    // The guard is per-field, not a blanket block: an assistant editing a note
    // or a due date must still be able to.
    const caller = appRouter.createCaller(contextFor("assistant"));
    await expect(
      caller.caseManagement.update({ id: 1, dueDate: new Date() })
    ).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the case brief cannot set the Director's flag", () => {
  it("refuses a staff officer, who may write briefs but not flag matters", async () => {
    expect(can("staff", "brief:write")).toBe(true);
    expect(can("staff", "matter:flag")).toBe(false);

    const caller = appRouter.createCaller(contextFor("staff"));
    await expect(
      caller.caseManagement.saveBrief({
        id: 1,
        issue: "An issue for the Director",
        background: "Background on the matter",
        actionTaken: "What the province has done",
        currentPosition: "Where the matter stands",
        issueRequiringDecision: "What needs deciding",
        recommendation: "What the province recommends",
        decisionRequired: true,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("platform:oversight reaches the data its own screen needs", () => {
  it("lets an administrator read the officer list the oversight picker uses", async () => {
    // The oversight screen offers these names in its reassignment control. They
    // were gated on platform:stats, which the Administrator tier does not hold,
    // so the tier granted oversight rights could not use them.
    expect(can("admin", "platform:oversight")).toBe(true);
    expect(can("admin", "platform:stats")).toBe(false);

    const caller = appRouter.createCaller(contextFor("admin"));
    // It resolves — to an empty list, because there is no database here. What
    // matters is that it resolves at all: before the gate was corrected this
    // refused with FORBIDDEN, and the tier that holds oversight rights could not
    // reach the picker on its own screen.
    await expect(caller.admin.officers()).resolves.toBeDefined();
  });

  it("still refuses a commissioner, who holds no platform capability", async () => {
    const caller = appRouter.createCaller(contextFor("commissioner"));
    await expect(caller.admin.officers()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("still refuses the province list to a commissioner", async () => {
    const caller = appRouter.createCaller(contextFor("commissioner"));
    await expect(caller.admin.provinces()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
