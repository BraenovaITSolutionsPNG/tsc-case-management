// Capability model, imported by both the server (route guards) and the client
// (navigation, dashboard composition). Keeping one list means a role cannot
// gain an option in the UI without the server agreeing, or lose one silently.
//
// Note on the boundary: hiding an option in the UI is a courtesy, not a
// security control. Every capability below is also enforced on the tRPC route,
// so calling the API directly cannot bypass what the navigation shows.

import { ROLE_LABELS, type Role } from "./roles";

export const CAPABILITIES = [
  /** Create a new matter in the central register. */
  "matter:register",
  /**
   * See the whole provincial register. Every tier holds this: the manual puts
   * the Director in the position of monitoring every matter (§8, §13), and the
   * Golden Rule in §17 is stated across the register as a whole. Retained as an
   * explicit capability so that read-only access, if it is ever introduced,
   * is a deliberate addition rather than an omission.
   */
  "matter:viewAll",
  /** Change status, due date, assigned officer, action required. */
  "matter:update",
  /** Move the §14 escalation ladder. */
  "matter:escalate",
  /** Refer a matter to a National Section, with the §5 triggers. */
  "matter:refer",
  /**
   * §12B "matters requiring the Director's attention" - flag a matter so it is
   * surfaced for a decision, and clear the flag once it has been dealt with.
   * Distinct from matter:update because the Director is the one who acts on it,
   * and because the flag is the PA's main instrument for monitoring.
   */
  "matter:flag",
  /**
   * §12D follow-up: record a National Section's response to a referral and keep
   * the matter moving. A separate capability from matter:update because this is
   * the PA's standing duty rather than casework on a matter they hold.
   */
  "referral:followUp",
  /** Record a decision and outcome on a matter. */
  "matter:decide",
  /** Prepare the §12C case brief for the Director. */
  "brief:write",
  /** Add or remove items on the §11 case file. */
  "file:write",
  /** §12E Director's reporting set. */
  "report:view",
  /** Reassign or restatus any matter for oversight purposes. */
  "platform:oversight",
  /** Manage user accounts and roles. */
  "platform:users",
  /** Read the global audit trail. */
  "platform:audit",
  /** Read system-wide statistics. */
  "platform:stats",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * What each tier can do. Higher tiers do not "inherit" by array order - the
 * sets are written out in full, so adding a capability to a tier is always a
 * deliberate edit rather than a side effect of where a role sits in the list.
 */
const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  // A provincial officer: runs the caseload day to day.
  staff: [
    "matter:register",
    "matter:viewAll",
    "matter:update",
    "matter:escalate",
    "matter:refer",
    // §4, under Referral: "Follow up until an outcome is received." §12D gives
    // the Professional Assistant the same duty from the monitoring side, so both
    // roles hold it - dropping it here would have locked officers out of
    // closing out their own referrals.
    "referral:followUp",
    "brief:write",
    "file:write",
  ],
  /**
   * The Professional Assistant to the Director (§12). Runs the office around the
   * caseload: maintains and monitors the central register, prepares the case
   * brief, follows up National Sections, and produces the reporting set.
   *
   * Deliberately without matter:refer and matter:decide. §4 makes the judgement
   * that a matter is outside provincial authority - and the §5 triggers that go
   * with it - the Provincial Officer's act, and §6/§12C make the decision the
   * Director's. Everything else in the office is shared.
   */
  assistant: [
    "matter:register",
    "matter:viewAll",
    "matter:update",
    "matter:escalate",
    "matter:flag",
    "referral:followUp",
    "brief:write",
    "file:write",
    "report:view",
  ],
  // The Director: everything an officer does, and records decisions.
  commissioner: [
    "matter:register",
    "matter:viewAll",
    "matter:update",
    "matter:escalate",
    "matter:refer",
    "matter:decide",
    "brief:write",
    "file:write",
    "report:view",
  ],
  // Administrative oversight across the division.
  admin: [
    "matter:register",
    "matter:viewAll",
    "matter:update",
    "matter:escalate",
    "matter:refer",
    "matter:decide",
    "brief:write",
    "file:write",
    "report:view",
    "platform:oversight",
  ],
  // The platform itself: accounts, audit, system health.
  super_admin: [...CAPABILITIES],
};

export function can(
  role: Role | null | undefined,
  capability: Capability
): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * Plain-language names for each capability, and the lowest tier that holds it.
 * A refusal message has to be readable by an officer, so it never shows a
 * capability key.
 */
const CAPABILITY_LABELS: Record<Capability, { action: string; minimum: Role }> =
  {
    "matter:register": { action: "register a new matter", minimum: "staff" },
    "matter:viewAll": {
      action: "view the whole provincial register",
      minimum: "staff",
    },
    "matter:update": { action: "update a matter", minimum: "staff" },
    "matter:escalate": { action: "escalate a matter", minimum: "staff" },
    "matter:refer": {
      action: "refer a matter to a National Section",
      minimum: "staff",
    },
    "matter:decide": {
      action: "record a decision on a matter",
      minimum: "commissioner",
    },
    "matter:flag": {
      action: "flag a matter for the Director's attention",
      minimum: "assistant",
    },
    "referral:followUp": {
      action: "record a National Section's response to a referral",
      minimum: "assistant",
    },
    "brief:write": { action: "prepare a case brief", minimum: "staff" },
    "file:write": { action: "add items to a case file", minimum: "staff" },
    "report:view": {
      action: "read the Director's reporting set",
      // §12E has the Professional Assistant preparing the weekly, monthly and
      // quarterly reports, so the Assistant is the lowest tier that reaches
      // this - not the Director, who receives them.
      minimum: "assistant",
    },
    "platform:oversight": {
      action: "oversee any matter in the register",
      minimum: "admin",
    },
    "platform:users": {
      action: "manage user accounts and roles",
      minimum: "super_admin",
    },
    "platform:audit": {
      action: "read the global audit trail",
      minimum: "super_admin",
    },
    "platform:stats": {
      action: "read system-wide statistics",
      minimum: "super_admin",
    },
  };

/**
 * The plain-language phrasing of each capability, for anywhere a role's powers
 * are listed rather than refused. The same strings the refusal is built from,
 * so an officer reading their own capabilities and an officer being refused see
 * one vocabulary.
 */
export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABELS[capability]?.action ?? capability;
}

/** A refusal an officer can act on, naming their role and what it would take. */
export function refusalFor(  role: Role | null | undefined,
  capability: Capability
): string {
  const { action, minimum } = CAPABILITY_LABELS[capability];
  const asRole = role
    ? ROLE_LABELS[role].toLowerCase()
    : "a signed-out visitor";
  return `${ROLE_LABELS[minimum]} permission is required to ${action}. You are signed in as ${asRole}.`;
}

/**
 * Whether any of the listed capabilities is held.
 *
 * An empty list means "no capability is required" - the item is open to every
 * signed-in user - so it is true. Returning false for it would make an ungated
 * item unreachable, which is the opposite of what an empty list means here.
 */
export function canAny(
  role: Role | null | undefined,
  capabilities: readonly Capability[]
): boolean {
  if (capabilities.length === 0) return true;
  return capabilities.some(capability => can(role, capability));
}

export function capabilitiesFor(
  role: Role | null | undefined
): readonly Capability[] {
  return role ? ROLE_CAPABILITIES[role] : [];
}

/** The home view a role lands on, so the first screen matches the job. */
export type DashboardVariant =
  | "officer"
  | "assistant"
  | "director"
  | "platform";

/**
 * Keyed off capability rather than raw rank: an administrator has oversight
 * rights but no system statistics, so it gets the Director's view plus the
 * oversight panel rather than a platform view with half of it denied.
 */
export function dashboardFor(role: Role | null | undefined): DashboardVariant {
  if (!role) return "officer";
  if (can(role, "platform:stats")) return "platform";
  if (can(role, "matter:decide")) return "director";
  if (can(role, "matter:flag")) return "assistant";
  return "officer";
}
