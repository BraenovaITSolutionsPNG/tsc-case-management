/**
 * Whether a configured Supabase project URL is one this deployment can talk to.
 *
 * Shared because both ends of the sign-in check need the same answer and must
 * not disagree: the server builds a client in `supabasePublicConfig`
 * (`server/_core/supabaseAuth.ts`) and the browser builds one in
 * `client/src/lib/supabase.ts`. A deployment whose two ends judge the same value
 * differently is back to a sign-in form that works on one side and not the
 * other, which is a harder thing to diagnose than either failing outright.
 *
 * @supabase/supabase-js validates this itself, and its message is accurate but
 * anonymous: "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL" does not
 * say which variable was wrong or what was in it, and it arrives from inside a
 * request whose error the caller downgrades to a console warning. So the value
 * is checked here, before the client is built, where the fault can be named.
 *
 * What it rejects in practice is a paste, not a typo: a value wrapped in the
 * quotes a shell export carries, a value with the `SUPABASE_URL=` prefix still
 * attached, or an unfilled placeholder. All three are non-empty, so the
 * "nothing is configured" check passes them and the deployment looks
 * configured right up until the first sign-in attempt.
 */

/**
 * The same shape supabase-js insists on, kept as a pattern rather than left to
 * `new URL` alone: `new URL` accepts plenty that is not an address this
 * deployment could reach, and the point of the check is to catch a mangled paste
 * early, not to reimplement a URL parser.
 *
 * Held at supabase-js's own bar — trim, then `http`/`https`, then parse — on
 * purpose. Tightening it would refuse deployments that work today, and this
 * guards against a paste going wrong, not against a hostname being unreachable.
 */
const HTTP_SCHEME = /^https?:\/\//i;

export function isSupabaseUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!HTTP_SCHEME.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why a present-but-unusable project URL is unusable, or `null` when it is fine.
 *
 * The value is quoted back into the message, which is the whole reason this
 * exists: the failure the operator sees is otherwise a validated-looking string
 * that looks correct in the dashboard and is not. `JSON.stringify` rather than
 * template interpolation, so surrounding quotes and a trailing newline are
 * visible in the log instead of being invisible whitespace.
 *
 * Absence is deliberately not a fault here. An unset variable is a different
 * failure with a different fix, reported by the caller that knows which
 * variables it looked at.
 *
 * @param value the configured value, verbatim
 * @param source the names the value could have been supplied under, for the
 *   message — the two spellings are reconciled before this is called, so the
 *   operator is told both rather than whichever one happened to win
 */
export function supabaseUrlFault(
  value: string | null | undefined,
  source: string
): string | null {
  if (!value || isSupabaseUrl(value)) return null;
  return (
    `The Supabase project URL on this deployment is not a URL: ${source} is set to ` +
    `${JSON.stringify(value)}, which is not an http or https address. It must be the ` +
    `project's own address — https://<project-ref>.supabase.co — and nothing else: no ` +
    `surrounding quotes, no trailing text, and no characters in front of https://.`
  );
}
