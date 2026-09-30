// The two classification lists a matter is filed under. Single source of truth:
// the list was previously written out three times - in the drizzle schema for
// the enum, again as a zod enum in the router, and again in the register's
// filter - which is exactly the arrangement that lets a province exist in the
// interface but be refused by the API.
//
// `matterTypeValues` is a narrower restatement of MATTER_CATEGORIES in
// delegation.ts and is kept beside it deliberately: the manual names the three
// categories, and the database column is an enum, so the stored values have to
// be a closed literal list rather than derived. Changing one means changing both.

import { DEFAULT_DESTINATION, type MatterCategory } from "./delegation";

/** §3 the three classes of matter the provincial office receives. */
export const matterTypeValues = [
  "Appointment",
  "Industrial & General",
  "Legal",
] as const;

export type MatterType = (typeof matterTypeValues)[number];

/**
 * The twenty provinces, in the code order the register lists them. Kept as a
 * literal tuple rather than derived: these are the Commission's own
 * abbreviations and the database column is a plain string, so the interface
 * offers exactly the list the Commission publishes.
 */
export const provinceValues = [
  "NCD",
  "Central",
  "Eastern Highlands",
  "East New Britain",
  "Madang",
  "Morobe",
  "New Ireland",
  "Northern",
  "Simbu",
  "Southern Highlands",
  "West New Britain",
  "Western",
  "Western Highlands",
  "Gulf",
  "Manus",
  "Milne Bay",
  "Jiwaka",
  "Hela",
  "Enga",
] as const;

export type Province = (typeof provinceValues)[number];

/** §3 the National Section a category is referred to by default. */
export function defaultSectionFor(category: MatterType): string {
  return DEFAULT_DESTINATION[category as MatterCategory] ?? "Provincial Matters";
}
