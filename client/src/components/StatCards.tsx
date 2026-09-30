"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The count row that opens the dashboard.
 *
 * `tone` carries meaning rather than decoration: a red count is a count the
 * Director is expected to act on, so a screen of red would be noise. Only
 * figures that are actually wrong get one.
 */
export function StatCards({
  stats,
}: {
  stats: {
    label: string;
    value: number | string;
    icon: LucideIcon;
    tone?: "default" | "alert" | "warning" | "good";
    hint?: string;
    onClick?: () => void;
  }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(stat => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}

const TONES: Record<string, string> = {
  default: "border-slate-200 bg-white",
  alert: "border-red-200 bg-red-50",
  warning: "border-amber-200 bg-amber-50",
  good: "border-emerald-200 bg-emerald-50",
};

const ICON_TONES: Record<string, string> = {
  default: "bg-slate-100 text-slate-600",
  alert: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  good: "bg-emerald-100 text-emerald-700",
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "default" | "alert" | "warning" | "good";
  hint?: string;
  onClick?: () => void;
}) {
  const body: ReactNode = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
          {label}
        </p>
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded",
            ICON_TONES[tone]
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
    </>
  );

  const className = cn(
    "block rounded-lg border p-4 text-left",
    TONES[tone],
    onClick && "cursor-pointer transition-shadow hover:shadow-sm"
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
