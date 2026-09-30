import { trpc } from "@/lib/trpc";

/**
 * Which reads each write dirties, declared once.
 *
 * The alternative was a list of `utils.x.y.invalidate()` calls written into each
 * `onSuccess`, and it had drifted. A decision recorded by the Commissioner
 * invalidated the matter's own file and the dashboard but not the register, so
 * the row an officer would have read on the next page load still showed the old
 * status. A status changed from the oversight screen never reached the register
 * or the dashboard at all. Changing an account's role or suspending it did not
 * refresh `auth.me`, so a super administrator who suspended themselves carried
 * on as a signed-in officer until something else happened to refetch.
 *
 * The reason it drifted is the part worth keeping. Several of these mutations
 * live two or three components below the one that owns the cache proxy, and
 * invalidate through an `onChanged` prop wired up at the call site. The effect of
 * a mutation is therefore not written anywhere near it, and cannot be found by
 * reading the mutation. Reading the mutation and concluding it invalidates
 * nothing gets the analysis wrong — which is exactly what happened while this
 * file was being written, on the four mutations that turn out to be fine.
 *
 * A quiet wrong number is the worst thing this app can show, so the mapping is
 * stated here, once, where a change to a read can be made to keep up with the
 * writes.
 *
 * These helpers list the reads a write *might* affect, including the ones a
 * particular mutation cannot have touched — registering a matter and recording a
 * Commissioner's decision both dirty the audit trail, and neither appends an
 * event. That is on purpose, and worth being explicit about because the instinct
 * is to be exact:
 *
 *   - Over-invalidating a query that is not mounted costs a boolean. React Query
 *     marks it stale and, finding no observer, fetches nothing.
 *   - Under-invalidating a query that is mounted costs the officer a wrong number
 *     with nothing on screen to say so.
 *
 * It is also what keeps the list from needing to be edited. A read added to the
 * matter file later is covered because the write says "a matter changed", not
 * because someone remembered a fifth invalidation.
 */

/**
 * The utility proxy `trpc.useUtils()` hands back. Taken from the hook's own
 * return type so the helpers stay in step with the installed tRPC version
 * instead of restating a structural type that could quietly stop matching.
 */
type TrpcUtils = ReturnType<typeof trpc.useUtils>;

/**
 * Marks a matter's reads stale after a write to that matter.
 *
 * `id` is the matter that was written, and is left off by the one write that has
 * no matter yet: registering a new one, where the server decides the reference.
 * The register and the dashboard are aggregates over the whole province, so they
 * are dirtied on every matter write regardless — one matter's status, assigned
 * officer or due date moves both.
 *
 * The audit trail is in the list because it reads `caseEvents`, and almost every
 * write here appends one: the status change, the Director's flag, the brief, a
 * note, a referral, a referral response, a document filed or withdrawn. The two
 * that do not are registering a matter and recording a Commissioner's decision,
 * and they are covered anyway — see the note on over-invalidating below.
 *
 * The invalidations are issued together rather than awaited one after another.
 * They are cache flags, not requests: React Query refetches only the ones that
 * are actually mounted, so `Promise.all` lets the cache be marked in one pass
 * rather than letting one figure land before the officer sees the next.
 */
export async function invalidateMatterWrites(
  utils: TrpcUtils,
  id?: number
): Promise<void> {
  await Promise.all([
    // The province-wide figures, the register at every filter, the oversight
    // view, and the audit trail over the events these writes append.
    utils.caseManagement.dashboard.invalidate(),
    utils.caseManagement.list.invalidate(),
    utils.caseManagement.summary.invalidate(),
    utils.admin.cases.list.invalidate(),
    utils.admin.audit.list.invalidate(),

    // The one matter's own file. Precise on purpose: a write to this matter
    // cannot change what another matter's file says, and invalidating every
    // matter in the cache would mean re-reading the province on each edit.
    ...(id === undefined
      ? []
      : [utils.caseManagement.getById.invalidate({ id })]),
  ]);
}

/**
 * Marks a user account's reads stale after a write to an account.
 *
 * `auth.me` is included because the super administrator screen is where an
 * officer can deactivate or delete their own account, and every screen in the
 * app is reading the current officer. It is a small query and it is usually
 * mounted, so the cost of the occasional extra read is lower than the cost of
 * an officer carrying on as an account the server has already closed.
 */
export async function invalidateUserWrites(utils: TrpcUtils): Promise<void> {
  await Promise.all([
    utils.admin.users.list.invalidate(),
    utils.auth.me.invalidate(),
  ]);
}

/**
 * Marks the signed-in officer's own record stale.
 *
 * The avatar is held on the user row, so `auth.me` is the only read that sees it
 * change. Every screen that shows a photograph is reading it through this.
 */
export async function invalidateSession(utils: TrpcUtils): Promise<void> {
  await utils.auth.me.invalidate();
}