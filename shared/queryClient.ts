import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * The one place a TanStack Query cache is configured.
 *
 * Both runtimes need a `QueryClient`: the browser builds one in
 * `app/providers.tsx`, and a Server Component builds one to prefetch into before
 * the HTML is sent. They must agree, because the server dehydrates its cache
 * into the page and the client hydrates it back out. A default that lives in one
 * of them and not the other would mean the hydrated cache silently disagrees
 * with the one it was written from, which shows up as data that is fetched
 * twice or not at all — so this lives in `shared/`, next to the other rules both
 * sides already import.
 */

/**
 * How long a fetched matter is considered fresh.
 *
 * App Router remounts a page component on every client-side navigation, and
 * without a non-zero `staleTime` React Query treats the data it was just handed
 * as already expired and refetches it immediately. That is invisible on the
 * server-rendered first paint (the data is already there, so no skeleton shows),
 * which is exactly what makes it worth setting: the officer sees the register
 * immediately, and the network request that would have replaced it with
 * identical data is skipped.
 *
 * Thirty seconds is short enough that an officer returning to a tab after a
 * short break still sees current figures, and long enough that moving between
 * the register, a matter and back does not re-read the province's whole register
 * three times. Writes do not wait on it: the mutations invalidate explicitly, and
 * an invalidation makes the query stale regardless of this number.
 */
export const QUERY_STALE_TIME_MS = 30_000;

/**
 * Unmounted queries are kept this long before their data is dropped, so a
 * back-navigation within the five minutes an officer is likely to take lands on
 * a warm cache rather than an empty one. React Query's own default, stated
 * explicitly because a register's rows are not small and the multiplier on every
 * cached key matters on the province's machines.
 */
export const QUERY_GC_TIME_MS = 5 * 60_000;

/**
 * The only failures worth sending a second request for.
 *
 * Everything else a procedure can answer with is a decision, not a fault: an
 * officer without the capability gets `FORBIDDEN`, a bad case reference gets
 * `NOT_FOUND`, a validation that failed gets `BAD_REQUEST`. Repeating those
 * requests cannot change the answer, and on this app they are expensive — the
 * register and the reporting set each read the whole province. A list of
 * unretryable codes would go stale the moment the app grew a procedure, so the
 * rule is the inverse: retry the codes that mean "the request never got
 * answered properly", and refuse to guess about anything else.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "INTERNAL_SERVER_ERROR",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
  "TIMEOUT",
]);

/** Two attempts after the first, rather than React Query's default three. */
export const MAX_QUERY_RETRIES = 2;

/**
 * The tRPC error code behind a thrown value, if there is one.
 *
 * Two shapes have to be read, because this file is used by both runtimes and
 * they do not agree. On the client a refusal arrives as a `TRPCClientError`
 * carrying the code under `data`, having crossed the wire. On the server the
 * same refusal is thrown by the procedure itself as a `TRPCError` with the code
 * on the top level and no `data` at all.
 *
 * Reading only the client shape would be the worse of the two mistakes, and a
 * quiet one: a refusal on the server would look like a failure with no code, fall
 * through to the network-failure branch, and be sent again — three times over —
 * for a request that was never going to be granted. That is the exact cost this
 * policy exists to remove, reintroduced on the half of the app that prefetches.
 *
 * Deliberately not `instanceof`. The two classes are from different packages, so
 * a single check cannot cover both, and neither identity survives the boundary
 * the value has actually crossed.
 */
export function trpcErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  // Server shape: a `TRPCError` thrown by the procedure.
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;

  // Client shape: a `TRPCClientError` reconstructed from the response body.
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;

  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Decides whether a failed query is worth repeating.
 *
 * Two cases are separated deliberately, because they are opposites:
 *
 *  - An error carrying a tRPC code was refused on purpose. Only the five codes
 *    above are transient. This is what stops an expired session turning into
 *    four requests per screen on the way to the sign-in page, which is what
 *    happens under the default "retry three times" behaviour.
 *  - An error carrying no tRPC code never reached a procedure at all — a dropped
 *    connection, a proxy that was restarting. Those are exactly what a retry is
 *    for, and they are the failures worth paying a second request for.
 *
 * The second case is the one to watch when extending this. It is a fallback for
 * "not a tRPC failure", so anything that fails without carrying a code is
 * treated as a transport problem and repeated. That is the right default for the
 * errors fetch actually throws, and the wrong one for a refusal that failed to
 * announce itself — which is why `trpcErrorCode` has to recognise both shapes.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;

  const code = trpcErrorCode(error);

  return code === null ? true : RETRYABLE_CODES.has(code);
}

/**
 * Builds a cache configured for this app.
 *
 * `dehydrate.serializeData` / `hydrate.deserializeData` are not optional. They
 * are how tRPC's `createHydrationHelpers` makes a server-side cache survive the
 * trip through the RSC payload: a matter's `Date` fields have to be revived as
 * `Date` objects on the client, and without these the dehydrated state carries
 * the plain JSON that `JSON.stringify` produced, so `dueDate` arrives as a
 * string and every deadline comparison silently takes the wrong branch.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: shouldRetryQuery,
        // Left on deliberately, and worth stating because turning it off is the
        // usual advice. `staleTime` already bounds it: returning to a tab inside
        // thirty seconds refetches nothing, so the repeated tab-switching that
        // makes focus refetching expensive elsewhere cannot happen here. What it
        // still buys is the case an officer spends an hour on — they switch to
        // check the manual, come back, and the matter's status is re-read
        // before they act on it. In an app whose rules are about not acting on a
        // stale register, that is the behaviour wanted.
        refetchOnWindowFocus: true,
      },
      dehydrate: {
        serializeData: superjson.serialize,
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  });
}
