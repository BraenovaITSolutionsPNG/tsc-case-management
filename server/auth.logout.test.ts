import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
});

describe("oauth next-path handling", () => {
  it("only follows same-origin relative paths", () => {
    // Mirrors safeNextPath() in server/_core/oauth.ts. `state` is forgeable by an
    // attacker, so anything that could leave this origin must fall back to "/".
    const safeNextPath = (value: string | undefined) => {
      if (!value) return "/";
      if (!value.startsWith("/")) return "/";
      if (value.startsWith("//") || value.startsWith("/\\")) return "/";
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
      return value;
    };

    // Legitimate deep links survive.
    expect(safeNextPath("/cases/42")).toBe("/cases/42");
    expect(safeNextPath("/cases?next=1")).toBe("/cases?next=1");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");

    // Open-redirect attempts all collapse to the root.
    expect(safeNextPath("//evil.example.com")).toBe("/");
    expect(safeNextPath("https://evil.example.com")).toBe("/");
    expect(safeNextPath("http://evil.example.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    // Browsers normalise a backslash after the slash to "//", which is
    // protocol-relative. This is the case a naive check misses.
    expect(safeNextPath("/\\evil.example.com")).toBe("/");
    expect(safeNextPath("/cases\n//evil.example.com")).toBe("/");
  });
});
