"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@server/routers";
import { StatusTag } from "@/components/StatusIcon";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  ChevronRight,
  FileText,
  Gavel,
  Inbox,
  Landmark,
  Scale,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The Professional Assistant's case monitoring.
 *
 * The manual lists exactly six things the register must surface and gives the
 * order it lists them in. That order is reproduced here rather than chosen, so
 * the screen reads the way the manual does and a PA can find each list where
 * they expect it. A seventh list, the case briefs still to prepare, is included
 * because it is derived from the same pass and an officer who has just flagged
 * a matter for decision needs to see what that obliges them to do.
 *
 * Every category carries the matters in it rather than a count: the PA's job is
 * to act on the list, and a number that cannot be clicked into is no use at 8am.
 */

/**
 * Inferred from the router rather than restated here. The payload has
 * literal status and matter-type unions and Date fields, and a hand-written
 * copy of it drifts the moment the server adds a status - the board would then
 * accept a value the server can never send, and reject one it can.
 */
type Monitoring = NonNullable<
  inferRouterOutputs<AppRouter>["caseManagement"]["dashboard"]["monitoring"]
>;

type SlimCase = Monitoring["newMatters"][number];

/**
 * The seven lists carry different extra columns, so the renderer is typed
 * against one wide shape with every extra field optional rather than a union
 * of seven row types. Each group's `extra` reads only the fields that group's
 * server query always sets, so the `?? 0` fallbacks are unreachable in practice.
 */
/**
 * `assignedOfficerName` is optional because two of the lists - the case briefs
 * and the decision list - are built from `slimCase` but do not carry it.
 * The renderer treats it as absent rather than as empty, which is also how the
 * server means it: the officer is genuinely not recorded, not recorded as none.
 */
type MonitorRow = Omit<SlimCase, "assignedOfficerName"> & {
  assignedOfficerName?: string | null;
  daysOpen?: number;
  daysOverdue?: number;
  daysWaiting?: number;
  responseDueDate?: Date | null;
  destination?: string;
  overdueOnFollowUp?: boolean;
  hasBrief?: boolean;
  escalationLevel?: number;
};

/**
 * `monitoring` is null when the database is unreachable: the server answers the
 * dashboard rather than failing the whole screen, so the rest of the overview
 * still renders. The board says so plainly instead of showing empty lists,
 * which would read as "nothing needs attention" - the opposite of the truth.
 */
export function CaseMonitoringBoard({
  monitoring,
}: {
  monitoring: Monitoring | null;
}) {
  const [open, setOpen] = useState<string>("delayMatters");

  if (!monitoring) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
        Monitoring is unavailable while the database is unreachable.
      </p>
    );
  }

  const groups: {
    key: string;
    label: string;
    icon: LucideIcon;
    rows: MonitorRow[];
    empty: string;
    /** Rendered after the officer column, for fields specific to this list. */
    extra?: (row: MonitorRow) => React.ReactNode;
  }[] = [
    {
      key: "newMatters",
      label: "New matters",
      icon: Inbox,
      rows: monitoring.newMatters,
      empty: "Nothing waiting to be picked up.",
    },
    {
      key: "outstanding",
      label: "Outstanding matters",
      icon: Briefcase,
      rows: monitoring.outstanding,
      empty: "No matters are open.",
      extra: row => (
        <span className="tabular-nums text-slate-600">
          {row.daysOpen ?? 0} days open
        </span>
      ),
    },
    {
      key: "delayMatters",
      label: "Delay matters",
      icon: AlertTriangle,
      rows: monitoring.delayMatters,
      empty: "Nothing is past its due date.",
      extra: row => (
        <span className="font-medium tabular-nums text-red-700">
          {row.daysOverdue ?? 0} days overdue
        </span>
      ),
    },
    {
      key: "legalMatters",
      label: "Legal matters",
      icon: Scale,
      rows: monitoring.legalMatters,
      empty: "No legal matters on the register.",
    },
    {
      key: "awaitingResponse",
      label: "Awaiting National Section",
      icon: Landmark,
      rows: monitoring.awaitingResponse,
      empty: "No referrals are outstanding.",
      extra: row => (
        <span
          className={cn(
            "tabular-nums",
            row.overdueOnFollowUp
              ? "font-medium text-red-700"
              : "text-slate-600"
          )}
        >
          {row.daysWaiting ?? 0} days waiting
          {row.destination ? ` · ${row.destination}` : ""}
        </span>
      ),
    },
    {
      key: "requiringDecision",
      label: "Requiring the Director's attention",
      icon: Gavel,
      rows: monitoring.requiringDecision,
      empty: "Nothing is flagged for decision.",
      extra: row => (
        <span className="text-slate-600">
          {row.hasBrief ? "Brief prepared" : "No brief prepared"}
        </span>
      ),
    },
    {
      key: "briefsToPrepare",
      label: "Case briefs to prepare",
      icon: FileText,
      rows: monitoring.briefsToPrepare,
      empty: "No briefs are outstanding.",
      extra: row => (
        <span className="text-slate-600">
          Level {row.escalationLevel ?? 1} · {row.daysOpen ?? 0} days open
        </span>
      ),
    },
  ];

  const active = groups.find(group => group.key === open) ?? groups[0];

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Case monitoring
          <span className="ml-2 text-xs font-normal text-slate-500">
            {monitoring.openTotal} open in total
          </span>
        </h2>
        <p className="text-xs text-slate-500">
          The six lists the manual requires, in the order it requires them, plus
          the case briefs still to prepare.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-2">
        {groups.map(group => {
          const Icon = group.icon;
          const selected = group.key === active.key;
          // The counts object is keyed by the same names as the lists, so the
          // lookup is total in practice; the row length is the fallback.
          const count =
            monitoring.counts[group.key as keyof typeof monitoring.counts];
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
                {count}
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
          {active.rows.slice(0, 50).map(row => (
            <li key={`${active.key}-${row.id}`}>
              <Link
                href={`/cases/${row.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">
                      {row.caseNumber}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-900">
                      {row.teacherName}
                    </span>
                    <StatusTag status={row.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span className="text-slate-500">{row.province}</span>
                    <span className="text-slate-500">{row.matterType}</span>
                    {row.assignedOfficerName ? (
                      <span className="flex items-center gap-1 text-slate-500">
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        {row.assignedOfficerName}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-700">
                        <Timer className="h-3 w-3" aria-hidden />
                        Unassigned
                      </span>
                    )}
                    {active.extra?.(row)}
                  </div>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-slate-300"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {active.rows.length > 50 ? (
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          Showing the first 50 of {active.rows.length}. Filter the register for
          the full set.
        </p>
      ) : null}
    </section>
  );
}
