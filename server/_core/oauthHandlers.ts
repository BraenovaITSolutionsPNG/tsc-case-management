import {
  COOKIE_NAME,
  ONE_YEAR_MS,
  OAUTH_STATE_COOKIE,
  decodeOAuthState,
} from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import * as db from "../db";
import { ROLE_VALUES, type Role } from "../../shared/roles";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import type { CookieMutation } from "./context";
import { safeNextPath } from "./localAuthHandlers";
import { sdk } from "./sdk";

/**
 * The Manus OAuth sign-in flow, as pure logic.
 *
 * The two entry points return a redirect or a JSON error rather than touching a
 * response object, so the Next.js route handlers in `app/api/**` own the
 * mechanics and this stays testable on its own.
 */

export type AuthResult = {
  status: number;
  body: Record<string, unknown>;
  cookies?: CookieMutation[];
  /** Set for a successful sign-in; the route handler turns it into a 302. */
  redirectTo?: string;
};

const notFound = (): AuthResult => ({
  status: 404,
  body: { error: "Not found" },
});

/**
 * Development-only login. The Manus OAuth portal is not reachable from a dev
 * machine, and its `__Host-` state cookie plus `SameSite=None` session cookie
 * both require HTTPS, so the real flow cannot complete over plain HTTP. This
 * skips both and mints the session directly. It 404s in production.
 */
export async function handleDevLogin(
  next: string | undefined,
  secure: boolean
): Promise<AuthResult> {
  if (ENV.isProduction) {
    return notFound();
  }

  const openId = ENV.devLoginOpenId.trim() || "dev_local_user";
  const name = ENV.devLoginName.trim() || "TSC Officer";
  const email = ENV.devLoginEmail.trim() || `${openId}@localhost`;
  const role = (
    ROLE_VALUES.includes(ENV.devLoginRole.trim() as Role)
      ? ENV.devLoginRole.trim()
      : "admin"
  ) as Role;

  try {
    await db.upsertUser({
      openId,
      name,
      email,
      loginMethod: "dev",
      role,
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(openId, {
      name,
      expiresInMs: ONE_YEAR_MS,
    });

    console.log(`[DevAuth] Signed in as ${openId} (${name}, ${role})`);
    return {
      status: 302,
      body: {},
      redirectTo: safeNextPath(next),
      cookies: [sessionCookie(sessionToken, secure)],
    };
  } catch (error) {
    console.error("[DevAuth] Login failed", error);
    return { status: 500, body: { error: "Dev login failed" } };
  }
}

export async function handleOAuthCallback(
  params: { code?: string; state?: string },
  cookieHeader: string,
  secure: boolean
): Promise<AuthResult> {
  const { code, state } = params;

  if (!code || !state) {
    return { status: 400, body: { error: "code and state are required" } };
  }

  // CSRF guard: the nonce in `state` must match the one-time cookie that
  // startLogin set in the browser that began this login. An attacker can forge
  // `state`, but cannot plant this cookie in the victim's browser.
  const { nonce, next } = decodeOAuthState(state);
  // Where to land afterwards. Re-validated at the redirect below.
  const expectedNonce = parseCookieHeader(cookieHeader)[OAUTH_STATE_COOKIE];
  if (!nonce || nonce !== expectedNonce) {
    return { status: 403, body: { error: "invalid oauth state" } };
  }

  const cookies: CookieMutation[] = [
    // The state cookie is single-use; clear it whatever happens next.
    {
      name: OAUTH_STATE_COOKIE,
      value: "",
      options: { path: "/", secure: true, sameSite: "none", maxAge: -1 },
    },
  ];

  try {
    const tokenResponse = await sdk.exchangeCodeForToken(code, state);
    const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

    if (!userInfo.openId) {
      return {
        status: 400,
        body: { error: "openId missing from user info" },
        cookies,
      };
    }

    await db.upsertUser({
      openId: userInfo.openId,
      name: userInfo.name || null,
      email: userInfo.email ?? null,
      loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
      lastSignedIn: new Date(),
    });

    const sessionToken = await sdk.createSessionToken(userInfo.openId, {
      name: userInfo.name || "",
      expiresInMs: ONE_YEAR_MS,
    });

    console.log(`[OAuth] Signed in as ${userInfo.openId} (${userInfo.name ?? ""})`);
    return {
      status: 302,
      body: {},
      // Honour the deep link the user originally asked for, carried in `state`
      // and re-validated here: `state` is attacker-forgeable, so the same
      // same-origin check the dev route uses must run before we redirect.
      redirectTo: safeNextPath(next),
      cookies: [...cookies, sessionCookie(sessionToken, secure)],
    };
  } catch (error) {
    console.error("[OAuth] Callback failed", error);
    return { status: 500, body: { error: "OAuth callback failed" }, cookies };
  }
}

function sessionCookie(token: string, secure: boolean): CookieMutation {
  return {
    name: COOKIE_NAME,
    value: token,
    options: {
      ...getSessionCookieOptions({ protocol: secure ? "https" : "http", headers: {} }),
      maxAge: ONE_YEAR_MS,
    },
  };
}

export { safeNextPath };
