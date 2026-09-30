import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import { getSessionCookieOptions, serializeCookie } from "./cookies";
import { ENV } from "./env";
import {
  hashPassword,
  normaliseUsername,
  validatePassword,
  verifyPassword,
} from "./localAuth";
import { sdk } from "./sdk";
import { ROLE_VALUES, type Role } from "../../shared/roles";
import type { CookieMutation } from "./context";

/**
 * Username-and-password sign-in.
 *
 * Two different things live here and they are no longer treated the same way:
 *
 * - `handleLogin` checks a credential that already exists. It is reachable in
 *   production. This deployment authenticates officers by password, because the
 *   Commission's identity provider is not configured on this instance, and a
 *   platform with no way in is not a working platform. The protections that make
 *   a password endpoint defensible are already in place and are load-bearing
 *   rather than optional: the stored hash is salted and slow, and both the
 *   username and the source address are rate limited.
 * - `handleSetCredential` creates a credential for an arbitrary role with no
 *   authorisation at all. It still 404s in production, and must keep doing so:
 *   enabling it would let any anonymous caller mint themselves a super
 *   administrator. It is a demonstrator's shortcut, not enrolment.
 *
 * The handlers return a plain `{ status, body, cookies }` rather than writing
 * to a response object, so the route handler owns serialisation and this logic
 * stays testable without a server.
 */

// Failed attempts in a rolling window, tracked per username and per source
// address. Without this, a password endpoint is a free guessing oracle.
//
// The two limits are deliberately different. Per username is tight, because
// that is a targeted attack on one account. Per address is loose, because a
// provincial office shares one NAT address behind a single public IP - eight
// typos by one officer would otherwise lock out everyone else in the building,
// which in a small division means the whole office. The address limit is a
// backstop against scripted spraying, not a lockout policy.
const MAX_ATTEMPTS_PER_USER = Number(
  process.env.LOCAL_AUTH_MAX_USER_ATTEMPTS ?? 8
);
const MAX_ATTEMPTS_PER_ADDRESS = Number(
  process.env.LOCAL_AUTH_MAX_ADDRESS_ATTEMPTS ?? 60
);
const WINDOW_MS = Number(process.env.LOCAL_AUTH_WINDOW_MS ?? 10 * 60 * 1000);

const failuresByUser = new Map<string, { count: number; first: number }>();
const failuresByAddress = new Map<string, { count: number; first: number }>();

function tooManyAttempts(
  key: string,
  store: Map<string, { count: number; first: number }>,
  limit: number
) {
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    store.delete(key);
    return false;
  }
  return entry.count >= limit;
}

function recordFailure(
  key: string,
  store: Map<string, { count: number; first: number }>
) {
  const entry = store.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    store.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

function clearFailures(
  key: string,
  store: Map<string, { count: number; first: number }>
) {
  store.delete(key);
}

export type AuthResult = {
  status: number;
  body: Record<string, unknown>;
  cookies?: CookieMutation[];
};

const notFound = (): AuthResult => ({
  status: 404,
  body: { error: "Not found" },
});

export async function handleLogin(
  body: Record<string, unknown>,
  address: string,
  secure: boolean
): Promise<AuthResult> {
  // Reachable in production: this is the credential check, not a way of
  // creating one. See the note at the top of this file. The rate limits below
  // are what make that acceptable, so they are no longer bypassable by
  // pointing the client at a production host.
  if (tooManyAttempts(address, failuresByAddress, MAX_ATTEMPTS_PER_ADDRESS)) {
    return {
      status: 429,
      body: { error: "Too many attempts. Wait a few minutes and try again." },
    };
  }

  const username =
    typeof body.username === "string" ? normaliseUsername(body.username) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const next = typeof body.next === "string" ? body.next : undefined;

  if (!username || !password) {
    return {
      status: 400,
      body: { error: "Enter both a username and a password." },
    };
  }
  if (tooManyAttempts(username, failuresByUser, MAX_ATTEMPTS_PER_USER)) {
    return {
      status: 429,
      body: {
        error:
          "Too many attempts for this username. Wait a few minutes and try again.",
      },
    };
  }

  const user = await db.getUserByLocalUsername(username);

  // Verify against a dummy hash when the account does not exist, so a missing
  // username and a wrong password take the same time and cannot be told apart.
  const stored = user?.passwordHash ?? DUMMY_HASH;
  const ok = verifyPassword(password, stored);

  if (!user || !user.passwordHash || !ok || !user.isActive) {
    recordFailure(username, failuresByUser);
    recordFailure(address, failuresByAddress);
    // One message for every failure: revealing which half was wrong would
    // confirm that a username exists.
    return {
      status: 401,
      body: { error: "That username and password do not match an account." },
    };
  }

  clearFailures(username, failuresByUser);
  clearFailures(address, failuresByAddress);

  await db.upsertUser({
    openId: user.openId,
    name: user.name,
    email: user.email,
    loginMethod: "local",
    role: user.role,
    isActive: user.isActive,
    passwordHash: user.passwordHash,
    lastSignedIn: new Date(),
  });

  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name ?? "",
    expiresInMs: ONE_YEAR_MS,
  });

  console.log(
    `[LocalAuth] Signed in as ${user.name ?? user.openId} (${user.role})`
  );

  return {
    status: 200,
    body: {
      ok: true,
      name: user.name,
      role: user.role,
      next: safeNextPath(next),
    },
    cookies: [
      {
        name: COOKIE_NAME,
        value: sessionToken,
        options: {
          ...getSessionCookieOptions({ protocol: secure ? "https" : "http", headers: {} }),
          maxAge: ONE_YEAR_MS,
        },
      },
    ],
  };
}

export async function handleSetCredential(
  body: Record<string, unknown>
): Promise<AuthResult> {
  if (ENV.isProduction) {
    return notFound();
  }

  const username =
    typeof body.username === "string" ? normaliseUsername(body.username) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : undefined;
  // The account's display name, as it should appear in the accountability
  // trail on every matter the person handles (§15).
  const displayName =
    typeof body.name === "string" ? body.name.trim() : "";

  if (!username || !password) {
    return {
      status: 400,
      body: { error: "Enter a username and a password." },
    };
  }
  const problem = validatePassword(password);
  if (problem) {
    return { status: 400, body: { error: problem } };
  }

  const existing = await db.getUserByLocalUsername(username);
  if (existing) {
    await db.setUserPassword(existing.id, hashPassword(password));
    if (displayName && displayName !== existing.name) {
      await db.setUserDisplayName(existing.id, displayName);
    }
    // Keep the explicit username in step, so the account signs in by the name
    // an administrator can actually see in the user list.
    if ((await db.getUserByLocalUsername(username))?.username !== username) {
      await db.setUserUsername(existing.id, username);
    }
    console.log(
      `[LocalAuth] Credential set for ${displayName || existing.name || username} (${existing.role})`
    );
    return {
      status: 200,
      body: {
        ok: true,
        name: displayName || existing.name,
        role: existing.role,
      },
    };
  }

  // Derived from the one list rather than restated: a hand-kept copy of the
  // role enum here silently fell back to "staff" when a tier was added, and
  // quietly created the wrong kind of account.
  const chosen = ROLE_VALUES.includes(role as Role) ? (role as Role) : "staff";

  const created = await db.createUser({
    openId: `local:${username}`,
    name: displayName || username,
    email: `${username}@local.test`,
    username,
    role: chosen,
    passwordHash: hashPassword(password),
  });
  console.log(
    `[LocalAuth] Created ${chosen} account "${username}" as ${created?.name}`
  );
  return { status: 200, body: { ok: true, name: created?.name, role: created?.role } };
}

/** Only same-origin relative paths, mirroring the OAuth callback's check. */
export function safeNextPath(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Control characters can be used to smuggle a scheme past the checks above.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}


export { serializeCookie };

/**
 * A real scrypt hash of a value nobody knows, used only to spend the same time
 * verifying a password when the username does not exist. Without it, a missing
 * account would return measurably faster than a wrong password.
 */
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "3p7Gqv0lWZ0a1Qb2Ck3DlE4Fm5Gn6Hp7Ir8Js9Kt0Lu1Mv2Nw3Ox4Py5Qz6Rq7St" +
  "8Uv9Wx0Ya1Zb2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6a7B8c";
