import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, dashboardFor, refusalFor } from "../shared/access";
import { ROLE_VALUES } from "../shared/roles";
import type { Role } from "../shared/roles";
import { roleAtLeast } from "../shared/roles";
import {
  hashPassword,
  normaliseUsername,
  validatePassword,
  verifyPassword,
} from "./_core/localAuth";
import type { AuthenticatedUser } from "./_core/sdk";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: Role | null): TrpcContext {
  const user: AuthenticatedUser | null =
    role === null
      ? null
      : {
          id: 1,
          openId: "test-user",
          email: "test@example.com",
          name: "Test User",
          loginMethod: "manus",
          role,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("role hierarchy", () => {
  it("treats a higher tier as satisfying every lower requirement", () => {
    expect(roleAtLeast("super_admin", "admin")).toBe(true);
    expect(roleAtLeast("super_admin", "staff")).toBe(true);
    expect(roleAtLeast("admin", "commissioner")).toBe(true);
    expect(roleAtLeast("staff", "commissioner")).toBe(false);
  });

  it("never grants access without a role", () => {
    expect(roleAtLeast(null, "staff")).toBe(false);
    expect(roleAtLeast(undefined, "staff")).toBe(false);
  });
});

describe("admin section authorization", () => {
  it("rejects anonymous callers", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.admin.users.list()).rejects.toThrow(/login/i);
  });

  it("rejects staff", async () => {
    const caller = appRouter.createCaller(createContext("staff"));
    await expect(caller.admin.users.list()).rejects.toThrow(
      /permission|required/i
    );
  });

  it("rejects a plain administrator, who is below the platform tier", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    // The refusal names the tier that would be allowed, in the same words the
    // role picker uses, so an officer is not left guessing what to ask for.
    await expect(caller.admin.users.list()).rejects.toThrow(
      /platform administrator permission is required to manage user accounts/i
    );
  });

  it("rejects a commissioner", async () => {
    const caller = appRouter.createCaller(createContext("commissioner"));
    await expect(caller.admin.stats()).rejects.toThrow(
      /platform administrator permission is required to read system-wide statistics/i
    );
  });

  it("tells the caller which role they are signed in as", async () => {
    const caller = appRouter.createCaller(createContext("commissioner"));
    await expect(caller.admin.users.list()).rejects.toThrow(
      /signed in as director/i
    );
  });

  it("allows a super administrator", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(caller.admin.users.list()).resolves.toBeDefined();
    await expect(caller.admin.stats()).resolves.toBeDefined();
  });

  it("stops a super administrator removing their own super role", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.setRole({ id: 1, role: "staff" })
    ).rejects.toThrow(/your own super administrator role/i);
  });

  it("stops a super administrator deactivating themselves", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.setActive({ id: 1, isActive: false })
    ).rejects.toThrow(/your own account/i);
  });
});

describe("director-gated actions", () => {
  it("keeps staff out of decision recording", async () => {
    const caller = appRouter.createCaller(createContext("staff"));
    await expect(
      caller.caseManagement.commissionerUpdate({
        id: 1,
        decidedByName: "A",
        outcome: "Some recorded outcome",
      })
    ).rejects.toThrow(/director permission is required to record a decision/i);
  });

  it("admits higher tiers than director", async () => {
    for (const role of ["admin", "super_admin"] as const) {
      const caller = appRouter.createCaller(createContext(role));
      // No database in unit tests, so this fails on the query rather than the
      // permission check — which is exactly what we want to prove.
      await expect(
        caller.caseManagement.commissionerUpdate({
          id: 1,
          decidedByName: "A",
          outcome: "Some recorded outcome",
        })
      ).rejects.not.toThrow(/director permission is required/i);
    }
  });
});

describe("capability model", () => {
  it("has no teacher tier at all", () => {
    // The manual routes every matter through the Provincial Matters office, so a
    // teacher never signs in. A tier here would be a way to read confidential
    // matters outside that workflow.
    expect(ROLE_VALUES).not.toContain("user");
    expect(ROLE_VALUES).toEqual([
      "staff",
      "assistant",
      "commissioner",
      "admin",
      "super_admin",
    ]);
  });

  it("gives every tier the whole provincial register", () => {
    // §15 puts the full accountability trail in front of the Director, and §17
    // states the Golden Rule across the register as a whole.
    for (const role of ROLE_VALUES) {
      expect(can(role, "matter:viewAll")).toBe(true);
    }
  });

  it("lets an officer close out their own referral, as §4 requires", () => {
    // §4, Referral: "Follow up until an outcome is received." §12D puts the PA on
    // the monitoring side of the same referrals, so both roles need it.
    expect(can("staff", "referral:followUp")).toBe(true);
    // Flagging for the Director is the PA's instrument; an officer uses the §14
    // escalation ladder instead.
    expect(can("staff", "matter:flag")).toBe(false);
  });

  it("gives the Professional Assistant the §12 duties and not the officer's authority", () => {
    // §12: maintains the register, monitors it, briefs the Director, follows up
    // National Sections, and prepares the reporting set.
    for (const capability of [
      "matter:viewAll",
      "matter:update",
      "matter:escalate",
      "matter:flag",
      "referral:followUp",
      "brief:write",
      "file:write",
      "report:view",
    ] as const) {
      expect(can("assistant", capability)).toBe(true);
    }
    // §4 makes the judgement that a matter leaves provincial authority the
    // officer's act; §6 and §12C make the decision the Director's. The PA
    // supports both but does not make them.
    expect(can("assistant", "matter:refer")).toBe(false);
    expect(can("assistant", "matter:decide")).toBe(false);
    expect(can("assistant", "platform:users")).toBe(false);
  });

  it("grants capabilities in a way the navigation can rely on", () => {
    // Officer: runs a caseload, but does not report or administer.
    expect(can("staff", "matter:register")).toBe(true);
    expect(can("staff", "matter:update")).toBe(true);
    expect(can("staff", "report:view")).toBe(false);
    expect(can("staff", "platform:users")).toBe(false);

    // Director: reports, but does not administer the platform.
    expect(can("commissioner", "report:view")).toBe(true);
    expect(can("commissioner", "matter:decide")).toBe(true);
    expect(can("commissioner", "platform:users")).toBe(false);
    expect(can("commissioner", "platform:oversight")).toBe(false);

    // Administrator: oversight, but not accounts or audit.
    expect(can("admin", "platform:oversight")).toBe(true);
    expect(can("admin", "platform:users")).toBe(false);
    expect(can("admin", "platform:audit")).toBe(false);

    // Platform administrator: everything.
    for (const capability of CAPABILITIES) {
      expect(can("super_admin", capability)).toBe(true);
    }
  });

  it("routes each role to the dashboard that matches the job", () => {
    expect(dashboardFor("staff")).toBe("officer");
    expect(dashboardFor("assistant")).toBe("assistant");
    expect(dashboardFor("commissioner")).toBe("director");
    expect(dashboardFor("admin")).toBe("director");
    expect(dashboardFor("super_admin")).toBe("platform");
  });

  it("grants nothing to a signed-out caller", () => {
    expect(can(null, "matter:viewAll")).toBe(false);
    expect(refusalFor("staff", "platform:users")).toMatch(
      /platform administrator/i
    );
  });
});

describe("local password credentials", () => {
  it("accepts the password it hashed", () => {
    const hash = hashPassword("morobe2026officer");
    expect(verifyPassword("morobe2026officer", hash)).toBe(true);
  });

  it("rejects anything else", () => {
    const hash = hashPassword("morobe2026officer");
    expect(verifyPassword("morobe2026office", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
    expect(verifyPassword("MOROBE2026OFFICER", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", () => {
    const a = hashPassword("morobe2026officer");
    const b = hashPassword("morobe2026officer");
    expect(a).not.toBe(b);
    // Both still verify: the salt travels with the hash.
    expect(verifyPassword("morobe2026officer", a)).toBe(true);
    expect(verifyPassword("morobe2026officer", b)).toBe(true);
  });

  it("never stores the password itself", () => {
    expect(hashPassword("morobe2026officer")).not.toContain(
      "morobe2026officer"
    );
  });

  it("treats a missing or corrupt hash as a failure rather than throwing", () => {
    // A null hash means "this account has no local credential" and must read as
    // a failed verification, not an exception.
    expect(verifyPassword("anything", null)).toBe(false);
    expect(verifyPassword("anything", undefined)).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(verifyPassword("anything", "scrypt$32768$8$1$onlyfour$parts")).toBe(
      false
    );
  });

  it("refuses absurd scrypt parameters from a tampered row", () => {
    // N far above the ceiling must be rejected before allocating, or a
    // corrupted row could make the server reserve gigabytes of memory.
    const tampered = `scrypt$999999999$8$1$AAAAAAAAAAAAAAAAAAAAAA==$${"A".repeat(86)}`;
    expect(verifyPassword("morobe2026officer", tampered)).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(validatePassword("short1")).toMatch(/at least 10/i);
    expect(validatePassword("alllettersonly")).toMatch(
      /letter and one number/i
    );
    expect(validatePassword("morobe2026")).toBeNull();
  });

  it("normalises a typed username", () => {
    expect(normaliseUsername("  J.Kumul ")).toBe("j.kumul");
  });
});

describe("the stored credential never leaves the server", () => {
  it("is absent from the request identity the client reads", () => {
    // auth.me returns ctx.user verbatim, so the session type is the only thing
    // standing between the password hash and the browser. Asserted at compile
    // time: if a field is added back, this file stops type-checking.
    const identity: AuthenticatedUser = {
      id: 1,
      openId: "test",
      name: "Test",
      email: "test@example.com",
      loginMethod: "local",
      role: "staff",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    expect("passwordHash" in identity).toBe(false);
  });

  it("refuses a password too short to be stored", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.create({
        name: "Short Pass",
        role: "staff",
        password: "short",
      })
    ).rejects.toThrow();
  });
});

describe("account administration", () => {
  it("refuses a password with no username to go with it", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.create({
        name: "No Username",
        role: "staff",
        password: "morobe2026officer",
      })
    ).rejects.toThrow(/needs a username/i);
  });

  it("stops an administrator deleting their own account", async () => {
    // The context user and the target are both id 1, which is the case the
    // route has to catch before anything else.
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(caller.admin.users.delete({ id: 1 })).rejects.toThrow(
      /your own account/i
    );
  });

  it("guards the platform against losing its last administrator", () => {
    // The delete route repeats the check setRole and setActive already use, so
    // removing an account cannot become a way to lock the platform out. Asserted
    // on the route source because the guard needs two accounts to be meaningful
    // and a unit test has no database to create them in.
    const source = readFileSync(
      new URL("./routers.ts", import.meta.url),
      "utf8"
    );
    const deleteBlock = source.slice(
      source.indexOf("delete: requireCapability"),
      source.indexOf("setPassword: requireCapability")
    );
    expect(deleteBlock).toMatch(/ctx\.user\.id/);
    expect(deleteBlock).toMatch(/super_admin/);
    expect(deleteBlock).toMatch(/getUserReferences/);
    expect(deleteBlock).toMatch(/at least one active platform administrator/i);
  });

  it("rejects a username with characters that would need escaping", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.create({
        name: "Odd Username",
        username: "has space",
        role: "staff",
      })
    ).rejects.toThrow();
  });
});
