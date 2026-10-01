import {
  authenticateSupabaseRequest,
  type AuthenticatedUser,
} from "./supabaseSession";

/**
 * The request shape the routers actually depend on.
 *
 * Deliberately structural rather than an Express or Next.js type. The app used
 * to run on Express and now runs on Next.js route handlers, which hand the
 * context a Web `Request`; binding the context to either would pin the router
 * to one runtime. The only two members any procedure touches are the ones
 * below, so a structural type keeps the router, the unit tests and the HTTP
 * adapter all speaking the same language.
 */
export type TrpcRequest = {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
};

/** A pending cookie write, replayed onto the outgoing HTTP response. */
export type CookieMutation = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

/** Mirrors the `cookie`/`clearCookie` pair the routers use. */
export type TrpcResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};

/**
 * `user` is the request identity and is returned to the client by `auth.me`, so
 * it is typed as AuthenticatedUser, which excludes the stored credential.
 */
export type TrpcContext = {
  req: TrpcRequest;
  res: TrpcResponse;
  user: AuthenticatedUser | null;
};

/**
 * A context plus the cookie writes made against it. Routers see only the
 * `TrpcContext` half; the HTTP adapter reads the mutations off and replays them
 * as real `Set-Cookie` headers.
 */
export type TrpcContextWithCookies = TrpcContext & {
  cookies: CookieMutation[];
};

export async function createContext(
  req: TrpcRequest
): Promise<TrpcContextWithCookies> {
  let user: AuthenticatedUser | null = null;

  try {
    user = await authenticateSupabaseRequest();
  } catch (error) {
    // Authentication is optional for public procedures, so a failure to resolve
    // a caller is not by itself an error. It is logged rather than swallowed:
    // a deployment with no Supabase configuration fails here on every request,
    // and a silent `user = null` would present that as "everyone is signed out"
    // instead of "this deployment is misconfigured".
    console.warn("[Auth] Could not resolve the Supabase session:", String(error));
    user = null;
  }

  return createContextFromUser(req, user);
}

/**
 * Builds a context around an already-established identity. The unit tests know
 * exactly who the caller is and only need the cookie plumbing, so they do not
 * re-run the session lookup.
 */
export function createContextFromUser(
  req: TrpcRequest,
  user: AuthenticatedUser | null
): TrpcContextWithCookies {
  const cookies: CookieMutation[] = [];

  return {
    req,
    res: {
      cookie(name, value, options) {
        cookies.push({ name, value, options });
      },
      clearCookie(name, options) {
        // An expired cookie is a write with a max age in the past, which is how
        // both Express and this recorder express "delete it".
        cookies.push({ name, value: "", options: { ...options, maxAge: -1 } });
      },
    },
    user,
    cookies,
  };
}
