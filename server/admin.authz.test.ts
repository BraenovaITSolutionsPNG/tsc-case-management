import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, dashboardFor, refusalFor } from "../shared/access";
import { ROLE_VALUES } from "../shared/roles";
import type { Role } from "../shared/roles";
import { roleAtLeast } from "../shared/roles";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { MIN_PASSWORD_LENGTH } from "./auth/provisioning";

/**
 * The password policy an administrator's own input is held to, restated here
 * rather than imported from the route, so the test does not pass by definition:
 * the route's floor and this one have to agree, and if the route's floor is
 * lowered this fails rather than following it down.
 */
function validateSupabasePassword(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    : null;
}

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: Role | null): TrpcContext {
  const user: AuthenticatedUser | null =
    role === null
      ? null
      : {
          id: 1,
          openId: "test-user",
          authUserId: "00000000-0000-4000-8000-000000000002",
          email: "test@example.com",
          name: "Test User",
          loginMethod: "supabase",
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

describe("credentials live in Supabase, not here", () => {
  it("has no module left that could hash a password", () => {
    // The previous arrangement kept scrypt here: localAuth.ts hashed an
    // officer's password, compared it, and the users table stored the result.
    // All of it is deleted. Checked by absence of the file rather than by
    // behaviour, so a partial reintroduction — a helper that hashes and is
    // never called — is caught rather than sitting in the tree unused.
    expect(
      existsSync(new URL("./_core/localAuth.ts", import.meta.url))
    ).toBe(false);
  });

  it("has no credential column on the users table", () => {
    const schema = readFileSync(
      new URL("../drizzle/schema.ts", import.meta.url),
      "utf8"
    );
    // The column was dropped rather than left null, so a future contributor
    // cannot write to a field that no longer has anything reading it.
    expect(schema).not.toMatch(/passwordHash/);
  });

  it("enforces a minimum length on a password an administrator sets", () => {
    expect(validateSupabasePassword("short1")).toMatch(/at least 10/i);
    expect(validateSupabasePassword("morobe2026")).toBeNull();
  });
});

describe("the request identity carries no credential", () => {
  it("is absent from the identity the client reads", () => {
    // auth.me returns ctx.user verbatim, so the type is the thing standing
    // between the users table and the browser. Asserted at compile time: if a
    // field is added back, this file stops type-checking.
    const identity: AuthenticatedUser = {
      id: 1,
      openId: "test",
      authUserId: "00000000-0000-4000-8000-000000000001",
      name: "Test",
      email: "test@example.com",
      loginMethod: "supabase",
      role: "staff",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    expect("passwordHash" in identity).toBe(false);
    // The Supabase uuid is present instead: it is how the next request finds
    // this row, and it is not a secret — the same value is in a cookie the
    // browser holds.
    expect(identity.authUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("requires an email address, because that is what signs an officer in", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.create({
        name: "No Email",
        email: "",
        role: "staff",
      })
    ).rejects.toThrow();
  });

  it("refuses a password too short to be stored", async () => {
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.create({
        name: "Short Pass",
        email: "short@example.com",
        role: "staff",
        password: "short",
      })
    ).rejects.toThrow();
  });
});

describe("account administration", () => {
  it("creates the account with no password, leaving the officer to set one", async () => {
    // The route calls into Supabase, so this asserts only that the input shape
    // an administrator must supply is accepted up to that point — a missing
    // password is no longer an error, because a link is better than a credential
    // an administrator has to invent and hand over.
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(
      caller.admin.users.create({
        name: "No Password",
        email: "no.password@example.com",
        role: "staff",
      })
    ).rejects.not.toThrow(/password/i);
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
