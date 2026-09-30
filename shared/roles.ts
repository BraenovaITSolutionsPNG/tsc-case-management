// Single source of truth for the access-control model. Imported by both the
// server (middleware, zod enums) and the client (labels, role pickers), so a
// new tier cannot be added on one side only.

/**
 * Access tiers, named for the jobs in the TSC Provincial Matters Administration
 * Manual.
 *
 * There is no teacher tier: the manual routes every matter through the
 * Provincial Matters office - §4 has the officer receiving the application, §6
 * has the Commission deciding - so a teacher never acts in this system.
 *
 * The tiers the manual actually names are the Provincial Matters Officer (§4)
 * and the Professional Assistant to the Director (§12), with the Director above
 * both. The two administrative tiers are not in the manual; they exist because
 * somebody has to provision accounts, and the manual is silent on that rather
 * than opposed to it.
 */
export const ROLE_VALUES = [
  "staff",
  "assistant",
  "commissioner",
  "admin",
  "super_admin",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

// Higher rank implies every capability of the ranks below it.
export const ROLE_RANK: Record<Role, number> = {
  staff: 1,
  assistant: 2,
  commissioner: 3,
  admin: 4,
  super_admin: 5,
};

export const ROLE_LABELS: Record<Role, string> = {
  staff: "Provincial officer",
  assistant: "Professional Assistant",
  commissioner: "Director",
  admin: "Administrator",
  super_admin: "Platform administrator",
};

/** The full job title, for the sign-in page and anywhere a badge has room. */
export const ROLE_TITLES: Record<Role, string> = {
  staff: "Provincial Matters Officer",
  assistant: "Professional Assistant to the Director, Provincial Matters",
  commissioner: "Director, Provincial Matters",
  admin: "Administrator",
  super_admin: "Platform administrator",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  staff:
    "A provincial officer. Registers, assigns, investigates, updates, refers, and follows up matters across the province.",
  assistant:
    "Keeps the central register and monitors it daily: identifies new, outstanding, delayed, legal and awaiting-response matters, prepares the case brief for the Director, follows up National Sections, and produces the weekly, monthly and quarterly reports.",
  commissioner:
    "The Director. Everything an officer does, plus records decisions and advice, and reads the reporting set.",
  admin:
    "Administrative oversight. Director's permissions, plus reassigning or restating any matter for oversight.",
  super_admin:
    "Looks after the platform itself: user accounts and roles, the global audit trail, and system-wide statistics.",
};

/** True when `role` is `minimum` or anything ranked above it. */
export function roleAtLeast(
  role: Role | null | undefined,
  minimum: Role
): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isSuperAdmin(role: Role | null | undefined): boolean {
  return role === "super_admin";
}
