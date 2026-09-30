// §10 Case status categories.
// "To help the Director monitor cases use standard status codes."
// Single source of truth: previously duplicated across five page components,
// which is how the labels and colours drifted apart.

export const STATUS_VALUES = [
  "NEW",
  "VER",
  "INV",
  "REF",
  "ADV",
  "DEC",
  "LEG",
  "ACT",
  "RES",
  "CLS",
  "ESC",
] as const;

export type CaseStatus = (typeof STATUS_VALUES)[number];

export const STATUS_LABELS: Record<CaseStatus, string> = {
  NEW: "Newly received",
  VER: "Verification required",
  INV: "Investigation in progress",
  REF: "Referred to National Section (HQ)",
  ADV: "Awaiting advice",
  DEC: "Awaiting decision",
  LEG: "With Legal Section",
  ACT: "Action being implemented",
  RES: "Resolved",
  CLS: "Closed",
  ESC: "Escalated due to delay",
};

/** Short labels for dense tables and badges. */
export const STATUS_SHORT: Record<CaseStatus, string> = {
  NEW: "New",
  VER: "Verification",
  INV: "Investigation",
  REF: "Referred",
  ADV: "Awaiting advice",
  DEC: "Awaiting decision",
  LEG: "Legal",
  ACT: "Action in progress",
  RES: "Resolved",
  CLS: "Closed",
  ESC: "Escalated",
};

/**
 * Status tags follow the industrial standard: a tinted plate with a border one
 * step stronger than the fill, so the tag keeps its edge on a white row. The
 * saturation is deliberately low - status is a label, not a highlight, and
 * eleven fully saturated colours at once would out-shout the data.
 */
export const STATUS_CLASSES: Record<CaseStatus, string> = {
  NEW: "bg-sky-50 text-sky-700 border-sky-200",
  VER: "bg-amber-50 text-amber-700 border-amber-200",
  INV: "bg-violet-50 text-violet-700 border-violet-200",
  REF: "bg-orange-50 text-orange-700 border-orange-200",
  ADV: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DEC: "bg-pink-50 text-pink-700 border-pink-200",
  LEG: "bg-rose-50 text-rose-700 border-rose-200",
  ACT: "bg-teal-50 text-teal-700 border-teal-200",
  RES: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLS: "bg-slate-100 text-slate-600 border-slate-200",
  ESC: "bg-red-50 text-red-700 border-red-200",
};

/** §10 statuses that represent a finished matter, excluded from "active". */
export const CLOSED_STATUSES: readonly CaseStatus[] = ["RES", "CLS"];

export function isOpenStatus(status: CaseStatus | string): boolean {
  return !CLOSED_STATUSES.includes(status as CaseStatus);
}

export function isOverdue(
  status: CaseStatus | string,
  dueDate: Date | string | null | undefined
): boolean {
  if (!dueDate || !isOpenStatus(status)) return false;
  return new Date(dueDate).getTime() < Date.now();
}

export function statusLabel(status: string): string {
  return STATUS_SHORT[status as CaseStatus] ?? status;
}
