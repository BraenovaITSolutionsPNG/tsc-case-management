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
 *
 * `refusal` is why `user` is null when the caller did present a session, and is
 * null whenever there was no session or the session was good.
 *
 * It exists for the officer whose sign-in is refused. `auth.me` answers null
 * either way, so without this the sign-in screen shows its form again — to
 * somebody who has just typed a correct password into it, and who will conclude
 * the password is wrong. The two causes need opposite responses: a deactivated
 * officer needs an administrator, and an unlinked identity needs one too, but
 * neither is fixable at the keyboard.
 *
 * Optional rather than required so the places that build a context by hand,
 * chiefly the tests, do not all have to state it. Absent and null mean the same
 * thing, which is what every reader wants.
 */
export type TrpcContext = {
  req: TrpcRequest;
  res: TrpcResponse;
  user: AuthenticatedUser | null;
  refusal?: string | null;
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
  let refusal: string | null = null;

  try {
    user = await authenticateSupabaseRequest();
  } catch (error) {
    // Authentication is optional for public procedures, so a failure to resolve
    // a caller is not by itself an error. It is logged rather than swallowed:
    // a deployment with no Supabase configuration fails here on every request,
    // and a silent `user = null` would present that as "everyone is signed out"
    // instead of "this deployment is misconfigured".
    console.warn(
      "[Auth] Could not resolve the Supabase session:",
      String(error)
    );
    // Kept, so the sign-in screen can say what happened instead of showing a
    // form to somebody who has already proved who they are.
    //
    // `error.message` rather than `String(error)`: the latter prefixes
    // "Error: ", which would make the pattern below never match and silently
    // discard every refusal while still logging it. Only the officer-facing
    // messages are carried — the ones thrown for a misconfigured deployment are
    // operator-facing, and those belong in the log, not on a screen.
    const message = error instanceof Error ? error.message : String(error);
    refusal =
      /^(This account has not been set up|This account has been deactivated)/.test(
        message
      )
        ? message
        : null;
    user = null;
  }

  return { ...createContextFromUser(req, user), refusal };
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
