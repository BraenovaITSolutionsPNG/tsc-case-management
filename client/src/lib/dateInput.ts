/**
 * How a calendar date is read and written.
 *
 * There are two kinds of date in this platform and they are not interchangeable:
 *
 *   - A **calendar date** — the day a matter was received, a due date, the date a
 *     matter was closed. An officer means a day of the month, not an instant. The
 *     register counts these by month, and a deadline is a day, not a moment.
 *   - An **instant** — when a row was written, when a referral was answered, when
 *     an officer was last seen. These are points on a timeline and belong in the
 *     reader's own timezone.
 *
 * The bug this module exists to prevent is one kind being read as the other.
 *
 * A calendar date crosses the wire as `YYYY-MM-DD` from `<input type="date">`, and
 * both halves of the stack turn that string into the *same* instant: `new
 * Date("2026-10-05")` is UTC midnight by specification, and so is `z.coerce.date()`
 * on the server. So a stored calendar date is always UTC midnight, and reading it
 * back with local getters is a bug — in any browser west of UTC, 2026-10-05T00:00Z
 * is still 4 October locally, so the officer typed the 5th and was shown the 4th,
 * on the register, on the case file, and in the due-date field itself. Only UTC
 * getters can read that value back as the day that was entered.
 *
 * Instants are the other way round and must keep using `toLocaleDateString`, or a
 * provincial officer reads an audit entry in the wrong timezone.
 *
 * So the two are separate functions with separate names, rather than one `format`
 * that a caller has to know the provenance of. The duplication this replaces —
 * three copies of `formatDate`, two of which read calendar dates with local
 * getters — is itself the defect: the copies had already drifted.
 *
 * `todayInputValue` is the one deliberate exception and reads *local* date parts,
 * because "today" is a fact about where the officer is sitting, not about UTC.
 * Its output is a calendar-date string like everything else, so it is then read
 * back with UTC getters like everything else.
 */

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The same shape, from the local date parts rather than the UTC ones. */
function fromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A `<input type="date">` value as the string the server wants.
 *
 * The two calendar-date getters below deliberately use *UTC* parts: the stored
 * instant is UTC midnight, and the day the officer entered is its UTC date. In a
 * browser west of UTC this is the difference between showing the date that was
 * typed and showing the day before it.
 */
export function toDateInputValue(
  value: Date | string | null | undefined
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return fromParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
}

/**
 * Today, as a date input wants it, for the browser the officer is sitting at.
 *
 * Local parts on purpose: this is the one value here that means "now, where you
 * are". A matter is closed on the day the officer closes it, and at 01:00 in a
 * UTC+10 province that is a different calendar day than it is in UTC. The result
 * is an ordinary calendar-date string, which everything else here reads back with
 * UTC getters.
 */
export function todayInputValue(): string {
  const now = new Date();
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * A calendar date, for a `<input type="date">` field.
 *
 * The value is left as the `YYYY-MM-DD` string rather than becoming a `Date`, so
 * the server's `z.coerce.date()` is the single place that decides what instant a
 * calendar date means. Round-tripping it through `new Date(...)` on the client
 * would work today — both parsers agree on UTC midnight — but it would put the
 * decision in two places, and the two would not stay in step.
 *
 * Returns `null` for anything that is not a complete `YYYY-MM-DD`, which is the
 * only shape an `<input type="date">` produces.
 */
export function parseDateInput(value: string): Date | null {
  if (!DATE_INPUT_PATTERN.test(value)) return null;
  return new Date(value);
}

/**
 * A calendar date for an officer to read: "5 Oct 2026".
 *
 * UTC, per the note at the top of this file. `padDay` gives the two-digit form
 * the oversight list prints — "05 Oct 2026" — which is what the register and the
 * case file did not, so it stays a choice rather than a second copy.
 */
export function formatDateOnly(
  value: Date | string | null | undefined,
  { padDay = false }: { padDay?: boolean } = {}
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const day = padDay
    ? String(date.getUTCDate()).padStart(2, "0")
    : String(date.getUTCDate());

  return `${day} ${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * An instant, for an officer to read: "5 Oct 2026, 14:33".
 *
 * Local, unlike everything above. `lastSeen` on an audit entry means when the
 * officer did that, in their own timezone.
 */
export function formatInstant(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Month names spelled the way `toLocaleDateString("en-AU", …)` spelled them.
 *
 * Hand-written rather than reached through `Intl` because the value has to be
 * formatted from its *UTC* parts, and `Intl.DateTimeFormat` can only be pointed
 * at a timezone — not at a set of parts. `timeZone: "UTC"` would work and reads
 * worse, and would put the correctness of this file on the ICU data rather than on
 * it.
 */
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
