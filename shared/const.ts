/**
 * The session cookie is now Supabase's, and its name is not ours to choose.
 *
 * `COOKIE_NAME` remains only as the value the sign-out route clears as a
 * belt-and-braces measure; @supabase/ssr knows the real names, including the
 * chunk index a large session is split across. It is not read on the request
 * path, and nothing in the app signs a session of its own.
 */
export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
