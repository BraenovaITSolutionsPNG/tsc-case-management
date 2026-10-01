/**
 * Administrator-side account operations against Supabase Auth.
 *
 * Everything in this file needs the service role, and nothing in it can be done
 * as a signed-in officer: Supabase deliberately exposes no API by which one user
 * can create or read another's credential. The public entry points are
 * `provisionUser`, `issuePasswordReset` and `removeIdentity`.
 *
 * The rule the whole module is built around: an identity and a register row are
 * two records, and they must not disagree about whether the account exists. A
 * Supabase user with no row can never sign in (the session lookup is by
 * `authUserId`); a row with no Supabase user is an account the admin screen shows
 * as unprovisioned. Neither is a security problem on its own, but the first is
 * a support call the officer cannot make themselves, so the second step is
 * compensated for when the first fails.
 */

import { createAdminClient } from "../_core/supabaseAuth";
import { createUser as createUserRow } from "../db";

/**
 * Supabase's own floor for a password, applied here so the refusal is a clear
 * message rather than an opaque 422 from the API.
 *
 * Exported because the admin route's validation and this one must not drift: a
 * password the form accepts and this rejects produces an error after the
 * administrator has already pressed the button.
 */
export const MIN_PASSWORD_LENGTH = 10;

export type ProvisionInput = {
  name: string;
  email: string;
  role: (typeof import("../../drizzle/schema").users.role.enumValues)[number];
  /** Temporary password. Omit to leave the officer to set their own via a reset link. */
  password?: string | null;
  username?: string | null;
};

/**
 * Create the Supabase identity, then the register row pointing at it.
 *
 * The order is the identity first, deliberately. If the row is written first and
 * the identity fails, the admin screen shows an account that cannot sign in and
 * the officer's first sign-in produces a message about contacting an
 * administrator. If the identity is written first and the row fails, the
 * compensation below removes the identity, and the failure surfaces as a failed
 * creation rather than as a working sign-in that leads nowhere.
 */
export async function provisionUser(input: ProvisionInput) {
  if (input.password && input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  const supabase = createAdminClient();

  // `listUsers` pages; 200 covers any plausible number of officers, and a
  // silently truncated check would let a duplicate address through.
  const { data: existing, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 200,
  });
  if (listError) {
    throw new Error(`Supabase could not be read: ${listError.message}`);
  }
  const clash = existing.users.find(
    (u) => u.email?.toLowerCase() === input.email.toLowerCase()
  );
  if (clash) {
    throw new Error(
      `An account already exists in Supabase for ${input.email}. It is not linked to this platform; an administrator needs to resolve it in the Supabase dashboard.`
    );
  }

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password ?? undefined,
      // Confirmed on creation: public signup is disabled, so this is an
      // administrator vouching for the address, and a confirmation email would
      // be a step with no security value and a real chance of being lost.
      email_confirm: true,
      user_metadata: { name: input.name },
    });

  if (createError || !created.user) {
    throw new Error(
      `The account could not be created in Supabase: ${createError?.message ?? "no user returned"}`
    );
  }

  try {
    return await createUserRow({
      // A stable openId so re-creating the same person does not duplicate the
      // row. Kept even though sign-in no longer uses it: the audit log
      // references it, and rewriting history to match a new scheme is worse than
      // carrying a field nothing reads.
      openId: `supabase:${created.user.id}`,
      name: input.name,
      email: input.email,
      username: input.username ?? null,
      role: input.role,
      authUserId: created.user.id,
    });
  } catch (error) {
    // Compensate. An orphaned identity cannot sign in, so leaving it would be
    // safe - but it would also occupy the email address, so the next attempt to
    // create this officer would fail on a clash with something invisible from
    // here. Remove it and let the failure stand.
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {
      // Nothing useful to do if this also fails. Say so, because the operator
      // needs to know the dashboard now holds an account with no register row.
      console.error(
        `[Auth] Could not remove the Supabase identity for ${input.email} after the register row failed to save. It must be deleted by hand.`
      );
    });
    throw error;
  }
}

/**
 * Ask Supabase for a password-reset link for an existing account.
 *
 * Returns the link so an administrator can pass it on. This is why the service
 * role is warranted: the reset token is a bearer credential for that account,
 * so it must not be generated anywhere the browser can read it, and must not be
 * logged. The caller is responsible for getting it to the officer over a channel
 * that is not this application.
 */
export async function issuePasswordReset(email: string): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (error || !data?.properties?.action_link) {
    throw new Error(
      `A reset link could not be generated: ${error?.message ?? "no link returned"}`
    );
  }
  return data.properties.action_link;
}

/**
 * Set a password directly, for an officer who cannot receive email.
 *
 * A genuine fallback rather than a convenience: a deployment with no SMTP
 * configured cannot send a recovery mail, and an officer locked out of a
 * disciplinary register is a problem that waits for no one. The cost is that this
 * process handles a real password, so it is deliberately a separate operation
 * from issuing a link, and it never writes the value anywhere.
 */
export async function setPasswordDirectly(
  authUserId: string,
  password: string
): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(authUserId, {
    password,
  });
  if (error) {
    throw new Error(`The password could not be set: ${error.message}`);
  }
}

/**
 * Remove the Supabase identity that goes with a deleted register row.
 *
 * Called after the row is gone, so a failure here leaves a live identity with
 * nothing behind it rather than a live identity attached to a row the audit
 * trail still points at. The row is cleared of its link first: after that the
 * session lookup can no longer resolve it, so the identity is already inert.
 */
export async function removeIdentity(authUserId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(authUserId);
  if (error) {
    throw new Error(
      `The Supabase account could not be removed: ${error.message}. It can no longer sign in, but it should be deleted from the Supabase dashboard.`
    );
  }
}
