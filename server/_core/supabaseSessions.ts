/**
 * Signing-in devices: listing them, and ending one.
 *
 * Supabase holds one row per signed-in browser, so "I am signed in on two
 * devices" is a real state and an officer on a shared or borrowed machine has no
 * way out of it today. `auth.logout` ends whichever session made the request;
 * ending the *other* one needs the service role and the Sessions API.
 *
 * ## Why this calls the REST API directly
 *
 * `@supabase/auth-js` 2.117 exposes `listUsers`, `deleteUser`, `generateLink` and
 * `signOut(jwt, scope)`, and nothing for sessions. `signOut` with a service-role
 * client takes a JWT and a scope, so it can end one session — but it cannot be
 * *given* a list to choose from, and the officer is the only one who knows which
 * device is the one in front of them. So the two endpoints below are called as they
 * are documented:
 *
 *   GET    /auth/v1/admin/users/{user_id}/sessions
 *   DELETE /auth/v1/admin/users/{user_id}/sessions/{session_id}
 *
 * Both are admin endpoints and both need the service role, which is why they live
 * here and not in `supabaseAuth.ts`'s client: `createAdminClient` is already the
 * escape hatch for the two operations that cannot be done as a user, and this is
 * now a third category — self-service, not an administrator action — so the
 * distinction is drawn in the module rather than in the caller.
 *
 * ## The one control that matters
 *
 * The user id is never taken from the client. Every function here requires the
 * caller's own `authUserId`, which the request context resolved from the session
 * cookie. A client that asked for "the sessions of user X" has no way to make this
 * answer about anything but itself, which is what keeps an officer from ending
 * anybody else's sessions.
 */

import { ENV } from "./env";
import { isSupabaseAdminConfigured } from "./supabaseAuth";

/** One signed-in browser, as this platform reports it to an officer. */
export type DeviceSession = {
  /** Supabase's session id. Opaque, and never shown. */
  id: string;
  /** Whether this is the session making the request. */
  current: boolean;
  /** A readable name for where this one is, e.g. "Chrome on Windows". */
  device: string;
  /** The address it signed in from, when Supabase records one. */
  ipAddress: string | null;
  signedInAt: Date | null;
  lastActiveAt: Date | null;
};

/** The shape Supabase returns from the sessions endpoint. */
type RawSession = {
  id?: unknown;
  user_agent?: unknown;
  ip_address?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  last_active_at?: unknown;
};

function adminBase(): string {
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so the signed-in devices on an account cannot be listed or ended."
    );
  }
  return `${ENV.supabaseUrl}/auth/v1`;
}

/**
 * The admin headers.
 *
 * Supabase wants the key in both places on admin endpoints: `apikey` for the
 * gateway and `Authorization` for the handler.
 */
function adminHeaders(): Record<string, string> {
  return {
    apikey: ENV.supabaseServiceRoleKey,
    Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Whether this deployment can manage sessions at all.
 *
 * The key's presence is not the whole answer, so this is reported rather than
 * assumed at the point of use. The panel stays visible and says so, instead of
 * offering a button that fails.
 */
export function canManageSessions(): boolean {
  return isSupabaseAdminConfigured();
}

/**
 * Every session the given user holds, newest first.
 *
 * `currentSessionId` marks the one making the request. It is optional because the
 * caller may not be able to resolve it, and an unmarked current session is a
 * degraded list rather than an error — see the note on `AuthenticatedUser`.
 */
export async function listSessions(
  userId: string,
  currentSessionId: string | null
): Promise<DeviceSession[]> {
  const response = await fetch(
    `${adminBase()}/admin/users/${encodeURIComponent(userId)}/sessions`,
    { headers: adminHeaders(), cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(await describeFailure(response, "list"));
  }

  const payload = (await response.json()) as unknown;
  const rows: RawSession[] = Array.isArray(payload)
    ? (payload as RawSession[])
    : Array.isArray((payload as { sessions?: unknown[] })?.sessions)
      ? (payload as { sessions: RawSession[] }).sessions
      : [];

  return rows
    .filter(row => typeof row?.id === "string" && row.id)
    .map(row => ({
      id: row.id as string,
      current: currentSessionId !== null && row.id === currentSessionId,
      device: describeDevice(row.user_agent),
      ipAddress: typeof row.ip_address === "string" ? row.ip_address : null,
      signedInAt: asDate(row.created_at),
      lastActiveAt: asDate(row.last_active_at ?? row.updated_at),
    }))
    .sort(
      (a, b) =>
        (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0)
    );
}

/**
 * End one session.
 *
 * The id is checked against `currentSessionId` by the caller rather than here,
 * because refusing to end your own session is a policy decision that belongs
 * beside the other capability checks — see `auth.revokeSession` in
 * `server/routers.ts`.
 */
export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const response = await fetch(
    `${adminBase()}/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: adminHeaders(), cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(await describeFailure(response, "revoke"));
  }
}

/** Ends every session except the one making the request. Returns how many. */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string | null
): Promise<number> {
  // With no current session to spare, "all the others" cannot be expressed. It
  // would include the device in front of the officer, so this refuses rather than
  // guessing: signing someone out of the machine they are using, from a button
  // labelled "other devices", is worse than not offering the action.
  if (currentSessionId === null) {
    throw new Error(
      "This deployment's sessions cannot be told apart, so the other devices cannot be spared. Use Sign out for this device instead."
    );
  }

  const sessions = await listSessions(userId, currentSessionId);
  const others = sessions.filter(session => !session.current);

  // Sequential rather than `Promise.all`: each call is a mutation to the same
  // account's sessions, and firing a dozen of them at one identity provider is how
  // a rate limit is reached on the one action an officer is waiting to complete.
  let ended = 0;
  for (const session of others) {
    await revokeSession(userId, session.id);
    ended += 1;
  }
  return ended;
}

/**
 * Turns a user-agent string into something an officer can recognise.
 *
 * An officer deciding whether to end a session cannot compare browser strings, and
 * cannot act on them at all if they do not know what a "Mozilla/5.0" prefix is. This
 * extracts browser and platform, and says honestly when it cannot tell — an
 * unrecognised agent is labelled rather than guessed at, because a wrong name on a
 * security control is worse than an unhelpful one.
 */
export function describeDevice(userAgent: unknown): string {
  if (typeof userAgent !== "string" || !userAgent.trim()) {
    return "Unknown device";
  }

  const agent = userAgent;
  const browser = firstMatch(agent, [
    [/Edg\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
    [/MSIE ([\d.]+)/, "Internet Explorer"],
  ]);

  const platform = firstMatch(agent, [
    [/Windows NT ([\d.]+)/, "Windows"],
    [/Android/, "Android"],
    [/(?:iPhone|iPad|iPod)/, "iOS"],
    [/Mac OS X/, "macOS"],
    [/CrOS/, "ChromeOS"],
    [/Linux/, "Linux"],
  ]);

  // A Linux agent covers far more than one platform — servers, crawlers, and
  // browsers whose agent omits a distribution — so "Linux" alone is said as
  // "Linux" and not dressed up as a particular distribution.
  const parts = [browser, platform].filter(Boolean) as string[];
  return parts.length ? parts.join(" on ") : "Unknown device";
}

function firstMatch(
  value: string,
  patterns: readonly [RegExp, string][]
): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) return label;
  }
  return null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turns a failed admin call into a sentence, without leaking the response body.
 *
 * Supabase's own error text can echo the key in a URL or name an internal table,
 * and this message is shown to an officer, so it reports the status and the action
 * and nothing else. The detail goes to the server log, where it is useful to an
 * operator and reaches nobody else.
 */
async function describeFailure(
  response: Response,
  action: "list" | "revoke"
): Promise<string> {
  const detail = await response.text().catch(() => "");
  console.error(
    `[Auth] Could not ${action} signed-in sessions (${response.status}):`,
    detail
  );

  if (response.status === 401 || response.status === 403) {
    return "The platform is not authorised to manage sessions on this deployment.";
  }
  if (response.status === 404) {
    return "Those sessions are no longer there. Reload the page to see the current list.";
  }
  return `Supabase could not be reached to ${action === "list" ? "list" : "end"} signed-in devices (status ${response.status}). Try again shortly.`;
}
