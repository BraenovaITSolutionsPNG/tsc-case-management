/**
 * Page arithmetic for the register, kept apart from the screen that uses it.
 *
 * The numbers here are all derived from two other numbers and none of them come
 * from the server, so they are the easiest part of pagination to get subtly
 * wrong and the hardest to notice: a register showing "page 4 of 2" is a bug
 * that only appears once someone has navigated to the end, and clamping a page
 * after a filter narrows the results is the case that actually happens — an
 * officer on page 3 who types a search should land on page 1, not on an empty
 * table.
 *
 * Pages are numbered from 1, because that is what is shown and what the
 * previous/next controls pass around. Offsets are derived at the point of use,
 * so no caller has to remember the conversion.
 */

/**
 * How many matters a page of the register holds.
 *
 * Twenty-five rather than ten because the register is scanned rather than read:
 * an officer looking for one matter among a province's open cases is looking for
 * a case number, a teacher's name or a province, and a longer page means fewer
 * pages to page through while searching. It also stays inside what a screenful
 * of a 70vh-scrolling table shows, so the sticky header keeps its meaning
 * without the page itself needing to scroll.
 */
export const REGISTER_PAGE_SIZE = 25;

/** Rows per page in the oversight view, which has more columns and fewer figures. */
export const OVERSIGHT_PAGE_SIZE = 20;

/**
 * Rows per page of the global audit trail.
 *
 * Fifty rather than the register's twenty-five: an audit trail is read by
 * reference, not scanned for one row, so the longer page trades a taller table
 * for fewer clicks through the history. The trail used to be a fixed 200 rows
 * with the search applied afterwards, which meant the history past those 200
 * entries could not be searched at all.
 */
export const AUDIT_PAGE_SIZE = 50;

/**
 * How many pages `total` rows fill, always at least one.
 *
 * The floor of one is deliberate. A register with nothing in it still has a
 * "page 1 of 1" to show rather than a division by zero or a "page 1 of 0", and
 * it means `clampPage` never has to special-case an empty result.
 */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Confines a page to the pages that exist.
 *
 * Called whenever the page is derived from state rather than set directly, so
 * that narrowing the filters under the officer's feet cannot leave them past the
 * end of the register. A page that is out of range becomes the last page that
 * has rows in it, which is what someone who was reading the back of the list
 * expects to see.
 */
export function clampPage(
  page: number,
  total: number,
  pageSize: number
): number {
  const last = pageCount(total, pageSize);

  // Only `NaN` needs handling. Every other impossible input already has the
  // right answer once it is truncated and bounded: an infinite page lands on the
  // last one, a negative one on the first. `NaN` is the one value that would
  // pass straight through `Math.min`/`Math.max` and reach the server as a
  // nonsense offset.
  if (Number.isNaN(page)) return 1;

  return Math.min(Math.max(Math.trunc(page), 1), last);
}

/** The row offset a 1-based page starts at. */
export function offsetFor(page: number, pageSize: number): number {
  return Math.max(0, (Math.trunc(page) - 1) * pageSize);
}

/**
 * The 1-based page an offset lands on, for reading a page out of a URL.
 *
 * Present because page numbers travel in links — a matter's file links back to
 * the page of the register it was found on — and going the other way is the
 * direction that is easy to get wrong by one.
 */
export function pageForOffset(offset: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.floor(Math.max(0, offset) / pageSize) + 1);
}
