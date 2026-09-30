import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type TestUser = NonNullable<TrpcContext["user"]>;

function contextFor(role: TestUser["role"]): TrpcContext {
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

describe("case management access control", () => {
  it("blocks staff from commissioner-only decisions", async () => {
    const caller = appRouter.createCaller(contextFor("staff"));
    await expect(caller.caseManagement.commissionerUpdate({
      id: 1,
      decidedByName: "Test Commissioner",
      outcome: "Decision recorded for testing",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows administrators to access the administrator guard", async () => {
    const caller = appRouter.createCaller(contextFor("admin"));
    await expect(caller.caseManagement.adminPing()).resolves.toEqual({ ok: true });
  });
});
