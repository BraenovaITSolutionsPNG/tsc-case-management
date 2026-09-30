import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Vite exposed these through `import.meta.env.VITE_*`. Next inlines only
// `NEXT_PUBLIC_*` into the client bundle, so the prefix changes. Reads go
// through `process.env` rather than a bare identifier because Next replaces the
// literal member expression at build time - a destructured or dynamic lookup
// would silently become undefined in the browser.
const oauthPortalUrl = process.env.NEXT_PUBLIC_OAUTH_PORTAL_URL;
const appId = process.env.NEXT_PUBLIC_APP_ID;
const isDev = process.env.NODE_ENV !== "production";

/**
 * Whether the identity provider is configured on this deployment.
 *
 * Exported so the sign-in screen can decide what to offer. `startLogin()` throws
 * when the portal is absent outside development, which is correct — but showing
 * a button that throws is worse than not showing it, so the screen needs to know
 * the answer rather than discovering it on click.
 */
export const isOAuthConfigured = Boolean(oauthPortalUrl);

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// It has SIDE EFFECTS — it mints a one-time nonce, writes the __Host- state
// cookie, and navigates immediately — so the cookie nonce always matches the
// `state` it sends. Do NOT call it during render (no `href={startLogin()}` /
// `loginUrl={...}`): each call overwrites the cookie, so a stray render-phase
// call would desync it from an in-flight login and the callback would reject it
// with "invalid oauth state". It returns void by design, so there is no URL to
// stash across renders.
export const startLogin = (next?: string) => {
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  // Only a same-origin relative path is ever forwarded, and the server
  // re-validates it, so a crafted `?next=` cannot turn the callback into an open
  // redirect. Mirrors safeNextPath() on the server: the backslash and
  // control-character cases are handled here too rather than relying on the
  // server alone.
  const nextPath =
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(next)
      ? next
      : undefined;

  if (!oauthPortalUrl) {
    // Local dev: the Manus portal is unreachable and its `__Host-` state cookie
    // cannot be set over plain HTTP, so the server exposes a development-only
    // login route that mints the session directly. It 404s in production.
    if (isDev) {
      window.location.href = nextPath
        ? `/api/dev/login?next=${encodeURIComponent(nextPath)}`
        : "/api/dev/login";
      return;
    }
    // Previously this built "undefined/app-auth" and `new URL()` threw a
    // TypeError inside the click handler, which looked like a dead button.
    throw new Error(
      "NEXT_PUBLIC_OAUTH_PORTAL_URL is not configured, so the login flow cannot start."
    );
  }

  const nonce = crypto.randomUUID();
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri, nonce, next: nextPath });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId ?? "");
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  window.location.href = url.toString();
};
