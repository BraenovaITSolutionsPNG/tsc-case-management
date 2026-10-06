"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@server/routers";
import { StatusTag } from "@/components/StatusIcon";
import { cn } from "@/lib/utils";
import { escalationLabel } from "@shared/delegation";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Gavel,
  Landmark,
  Scale,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The Director's desk.
 *
 * The overview a Director lands on is his inbox, not the whole provincial
 * monitoring set: matters that are for him or have been raised to him. The four
 * lists and the predicates behind them live in `getDirectorDesk` on the server,
 * so this screen only renders what it was sent and never re-decides what counts.
 *
 * The tab structure deliberately mirrors `CaseMonitoringBoard` so the two desks
 * read the same way - the PA and the Director are the two ends of the same
 * §12B/§12C flag-and-decide cycle, and an officer moving between them should not
 * have to relearn the list.
 */

type Desk = NonNullable<
  inferRouterOutputs<AppRouter>["caseManagement"]["dashboard"]["director"]
>;

type DeskRow =
  | Desk["awaitingDecision"][number]
  | Desk["raisedToDirector"][number]
  | Desk["urgent"][number]
  | Desk["overdue"][number];

function rowColumns(row: DeskRow): {
  id: number;
  caseNumber: string;
  teacherName: string;
  province: string;
  matterType: string;
  status: string;
  assignedOfficerName?: string | null;
  right: React.ReactNode;
  extra: React.ReactNode;
} {
  const base = {
    id: row.id,
    caseNumber: row.caseNumber,
    teacherName: row.teacherName,
    province: row.province,
    matterType: row.matterType,
    status: row.status,
    assignedOfficerName: row.assignedOfficerName,
  };

  if ("issueRequiringDecision" in row) {
    return {
      ...base,
      right: (
        <span
          className={cn(
            "shrink-0 rounded px-2 py-0.5 text-xs font-medium tabular-nums",
            row.hasBrief
              ? "bg-slate-100 text-slate-600"
              : "bg-amber-50 text-amber-700"
          )}
        >
          {row.daysOutstanding}d outstanding
        </span>
      ),
      extra: (
        <span className="flex items-center gap-1 text-slate-600">
          <Gavel className="h-3 w-3" aria-hidden />
          <span className="text-slate-600">
            {row.hasBrief ? "Brief prepared" : "No brief prepared"}
          </span>
          {row.recommendation ? (
            <span className="text-slate-500">
              · recommends: {row.recommendation}
            </span>
          ) : null}
        </span>
      ),
    };
  }

  if ("escalationLevel" in row) {
    return {
      ...base,
      right: (
        <span className="shrink-0 rounded bg-violet-50 px-2 py-0.5 text-xs font-medium tabular-nums text-violet-700">
          {escalationLabel(row.escalationLevel)}
        </span>
      ),
      extra: (
        <span className="text-slate-600">{row.daysOpen ?? 0} days open</span>
      ),
    };
  }

  if ("daysOverdue" in row) {
    return {
      ...base,
      right: (
        <span
          className={cn(
            "shrink-0 rounded px-2 py-0.5 text-xs font-medium tabular-nums",
            row.daysOverdue > 0
              ? "bg-red-50 text-red-700"
              : "bg-slate-100 text-slate-600"
          )}
        >
          {row.daysOverdue}d overdue
        </span>
      ),
      extra: null,
    };
  }

  return { ...base, right: null, extra: null };
}

export function DirectorDesk({ desk }: { desk: Desk }) {
  const [open, setOpen] = useState<string>("awaitingDecision");

  const groups: {
    key: keyof Desk["counts"];
    label: string;
    icon: LucideIcon;
    rows: DeskRow[];
    empty: string;
  }[] = [
    {
      key: "awaitingDecision",
      label: "Awaiting your decision",
      icon: Gavel,
      rows: desk.awaitingDecision,
      empty: "Nothing is waiting on your decision.",
    },
    {
      key: "raisedToDirector",
      label: "Raised to you",
      icon: Landmark,
      rows: desk.raisedToDirector,
      empty: "Nothing has been raised to your level.",
    },
    {
      key: "urgent",
      label: "Urgent",
      icon: Scale,
      rows: desk.urgent,
      empty: "No urgent matters are open.",
    },
    {
      key: "overdue",
      label: "Overdue",
      icon: AlertTriangle,
      rows: desk.overdue,
      empty: "Nothing is past its due date.",
    },
  ];

  const active = groups.find(group => group.key === open) ?? groups[0];

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Your desk
          <span className="ml-2 text-xs font-normal text-slate-500">
            The matters raised to you, and those that need your eye
          </span>
        </h2>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-2">
        {groups.map(group => {
          const Icon = group.icon;
          const selected = group.key === active.key;
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => setOpen(group.key)}
              aria-current={selected}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {group.label}
              <span
                className={cn(
                  "rounded px-1 text-[11px] tabular-nums",
                  selected ? "bg-white/20" : "bg-slate-100 text-slate-700"
                )}
              >
                {desk.counts[group.key as keyof typeof desk.counts]}
              </span>
            </button>
          );
        })}
      </div>

      {active.rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-slate-500">
          {active.empty}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {active.rows.slice(0, 50).map(row => {
            const columns = rowColumns(row);
            return (
              <li key={`${active.key}-${columns.id}`}>
                <Link
                  href={`/cases/${columns.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">
                        {columns.caseNumber}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-900">
                        {columns.teacherName}
                      </span>
                      <StatusTag status={columns.status} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                      <span className="text-slate-500">{columns.province}</span>
                      <span className="text-slate-500">
                        {columns.matterType}
                      </span>
                      {columns.assignedOfficerName ? (
                        <span className="flex items-center gap-1 text-slate-500">
                          <Timer className="h-3 w-3" aria-hidden />
                          {columns.assignedOfficerName}
                        </span>
                      ) : null}
                      {columns.extra}
                    </div>
                  </div>
                  {columns.right}
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-slate-300"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {active.rows.length > 50 ? (
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          Showing the first 50. Open the matter for the full set.
        </p>
      ) : null}
    </section>
  );
}
