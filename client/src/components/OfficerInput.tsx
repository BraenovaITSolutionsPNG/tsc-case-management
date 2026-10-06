"use client";

import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useId } from "react";

/**
 * The "Assigned officer" field: a picker over the active officer accounts, and
 * still a plain text box.
 *
 * A native `<datalist>` rather than the Radix `Select` the oversight screen
 * uses for reassignment, and the difference is deliberate. The register carries
 * the officer as a **name**, not an id - that is what the file shows and what
 * `findUserIdByName` resolves on the write - so a name with no account behind
 * it is a valid assignment that resolves to a null id instead of an error.
 * A strict select would make that impossible, and would offer no way to clear
 * the field back to unassigned. Picking is offered; typing is not taken away.
 *
 * The list is a convenience, never a gate: while it loads, and if it fails
 * outright, this renders exactly the input that was here before. An officer
 * should not be unable to register a matter because the roster request failed.
 */
export function OfficerInput(props: React.ComponentProps<typeof Input>) {
  const officers = trpc.caseManagement.officerNames.useQuery(undefined, {
    // The field works without the list, so a failed attempt is not worth
    // three more of them before the input settles.
    retry: false,
  });
  const listId = `officer-options-${useId().replace(/:/g, "")}`;

  return (
    <>
      <Input list={listId} {...props} />
      <datalist id={listId}>
        {(officers.data ?? []).map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
