import {
  STATUS_CLASSES,
  STATUS_SHORT,
  type CaseStatus,
} from "@shared/statuses";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  Gavel,
  Landmark,
  Send,
  ShieldAlert,
  UserSearch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The status plate used across the register, the detail header and the
 * monitoring board.
 *
 * The colour classes come from `shared/statuses.ts` rather than being restated
 * here: eleven statuses styled in three places is exactly how the palette
 * drifted before that file became the single source of truth.
 */

const ICONS: Record<CaseStatus, LucideIcon> = {
  NEW: Send,
  VER: UserSearch,
  INV: ShieldAlert,
  REF: Landmark,
  ADV: Clock,
  DEC: Gavel,
  LEG: Gavel,
  ACT: CircleDot,
  RES: CheckCircle2,
  CLS: CheckCircle2,
  ESC: AlertTriangle,
};

export function StatusIcon({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const key = (status in ICONS ? status : "NEW") as CaseStatus;
  const Icon = ICONS[key];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden />;
}

export function StatusTag({
  status,
  className,
  short = true,
}: {
  status: string;
  className?: string;
  short?: boolean;
}) {
  const key = (status in STATUS_CLASSES ? status : "NEW") as CaseStatus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium",
        STATUS_CLASSES[key],
        className
      )}
    >
      <StatusIcon status={key} className="h-3.5 w-3.5" />
      {short ? STATUS_SHORT[key] : key}
    </span>
  );
}
