"use client";

import { useAuth } from "@/_core/hooks/useAuth";
import { useRouteNavigate } from "@/hooks/useRouteNavigate";
import { CaseMonitoringBoard } from "@/components/CaseMonitoringBoard";
import { DashboardCharts } from "@/components/DashboardCharts";
import DashboardLayout from "@/components/DashboardLayout";
import { DirectorDesk } from "@/components/DirectorDesk";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { StatCards } from "@/components/StatCards";
import { StatusTag } from "@/components/StatusIcon";
import { ErrorState, LoadingState } from "@/components/States";
import { CardPanel } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { dashboardFor } from "@shared/access";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  Gavel,
  Inbox,
  Landmark,
  LayoutDashboard,
  Scale,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";

/**
 * The overview.
 *
 * Which figures lead is decided by `dashboardFor(role)` rather than by the
 * officer's job title. A Director opens this to see what needs a decision; a
 * Professional Assistant opens it to work the monitoring lists; an ordinary
 * caseworker opens it to see their own matters. The manual puts all three in
 * front of the same screen, so the variant changes the emphasis, not the layout.
 *
 * Every panel here is one read of the same `caseManagement.dashboard` payload.
 * Splitting them into separate queries would let the counts on screen disagree
 * with each other whenever a matter is registered mid-refresh, which is exactly
 * the sort of thing an officer would be asked to explain.
 */

const VARIANT_COPY: Record<
  ReturnType<typeof dashboardFor>,
  { eyebrow: string; title: string; description: string }
> = {
  officer: {
    eyebrow: "Your desk",
    title: "Overview",
    description: "The matters on your desk, and what is falling due.",
  },
  assistant: {
    eyebrow: "Monitoring",
    title: "Case monitoring",
    description: "The six lists the manual requires, and the matters in each.",
  },
  director: {
    eyebrow: "Your desk",
    title: "Matters raised to you",
    description:
      "The matters awaiting your decision, and those that need your eye.",
  },
  platform: {
    eyebrow: "System-wide",
    title: "Platform overview",
    description:
      "Statistics across the register, by province and by matter type.",
  },
};

export default function Home() {
  const router = useRouter();
  // Opening a matter from the monitoring board is a click on a matter rather
  // than on a URL, so it goes through the navigating helper to announce the
  // wait — this is one of the heavier renders in the platform, and it used to
  // arrive with nothing said while it did.
  const navigate = useRouteNavigate();
  // No `redirectOnUnauthenticated` here. That option force-launches the login
  // flow, which in development signs the visitor in as the dev owner without
  // them asking — so a signed-out officer landing here was silently given a
  // session instead of being sent to the sign-in page. The redirect below is
  // the one behaviour, and it is the same one every other screen now uses.
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.caseManagement.dashboard.useQuery();

  // Sign-out is initiated on other screens (the layout's menu, or a 401
  // anywhere). When it lands, this screen must not keep rendering a signed-in
  // officer's data behind a login prompt.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) router.replace("/login");
  }, [authLoading, isAuthenticated, router]);

  const data = query.data;

  if (query.error) {
    return (
      <DashboardLayout>
        <PageShell>
          <CardPanel>
            <ErrorState
              title="The dashboard could not be loaded"
              message={query.error.message}
              onRetry={() => void utils.caseManagement.dashboard.invalidate()}
            />
          </CardPanel>
        </PageShell>
      </DashboardLayout>
    );
  }

  if (authLoading || !data) {
    return (
      <DashboardLayout>
        <PageShell className="space-y-5">
          {/* The shape of the overview, so the page does not resize when it
              arrives. Wrapped rather than bare so the wait is announced - see
              `LoadingState`. */}
          <LoadingState label="The dashboard">
            <Skeleton className="h-8 w-64" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-lg" />
          </LoadingState>
        </PageShell>
      </DashboardLayout>
    );
  }

  const variant = dashboardFor(user?.role);
  const copy = VARIANT_COPY[variant];
  // Null only when the database is unreachable; the board renders its own
  // notice for that case, so the counts below fall back to zero rather than
  // claiming there is nothing waiting.
  const monitoring = data.monitoring;
  const newMatters = monitoring?.counts.newMatters ?? 0;
  const directorCounts = data.director.counts;

  // The Director variant leads with the desk of matters raised to him;
  // the Assistant leads with the monitoring lists; the officer with the charts
  // and then the lists. Each is the part of the screen that role acts on.
  const leadWithDirector = variant === "director";
  const leadWithMonitoring = variant === "assistant";

  const stats: {
    label: string;
    value: number;
    icon: LucideIcon;
    tone?: "default" | "alert" | "warning" | "good";
    hint?: string;
  }[] = leadWithDirector
    ? [
        {
          label: "Awaiting your decision",
          value: directorCounts.awaitingDecision,
          icon: Gavel,
          tone: directorCounts.awaitingDecision > 0 ? "alert" : "good",
          hint:
            directorCounts.awaitingDecision > 0
              ? "Needs a decision"
              : "Nothing waiting",
        },
        {
          label: "Raised to your level",
          value: directorCounts.raisedToDirector,
          icon: Landmark,
          tone: directorCounts.raisedToDirector > 0 ? "warning" : "default",
        },
        {
          label: "Urgent matters",
          value: directorCounts.urgent,
          icon: Scale,
          tone: directorCounts.urgent > 0 ? "warning" : "default",
          hint: "In the weekly brief",
        },
        {
          label: "Overdue",
          value: directorCounts.overdue,
          icon: AlertTriangle,
          tone: directorCounts.overdue > 0 ? "alert" : "good",
          hint:
            directorCounts.overdue > 0 ? "Needs attention" : "Nothing is late",
        },
      ]
    : [
        {
          label: "Matters on the register",
          value: data.totals.all,
          icon: FolderOpen,
          hint: `${data.totals.active} still open`,
        },
        {
          label: "Past their due date",
          value: data.totals.overdue,
          icon: AlertTriangle,
          tone: data.totals.overdue > 0 ? "alert" : "good",
          hint: data.totals.overdue > 0 ? "Needs attention" : "Nothing is late",
        },
        {
          label: "Due within seven days",
          value: data.totals.dueSoon,
          icon: CalendarClock,
          tone: data.totals.dueSoon > 0 ? "warning" : "default",
        },
        {
          label: "Not yet picked up",
          value: newMatters,
          icon: Inbox,
          tone: newMatters > 0 ? "warning" : "good",
          hint: "Awaiting first action",
        },
      ];

  return (
    <DashboardLayout>
      <PageShell>
        <PageHeader
          eyebrow={copy.eyebrow}
          title={copy.title}
          description={copy.description}
          icon={LayoutDashboard}
          action={
            <Button asChild size="sm">
              <Link href="/cases/new">
                <FilePlus2 className="mr-2 h-4 w-4" />
                Register matter
              </Link>
            </Button>
          }
        />

        <StatCards stats={stats} />

        {leadWithDirector ? (
          <DirectorDesk desk={data.director} />
        ) : leadWithMonitoring ? (
          <CaseMonitoringBoard monitoring={monitoring} />
        ) : (
          <>
            <DashboardCharts data={data} />
            <CaseMonitoringBoard monitoring={monitoring} />
          </>
        )}

        {leadWithDirector ? null : (
          <RecentMatters
            recent={data.recent}
            overdue={data.overdueCases}
            closureMedianDays={data.closure.medianDays}
            onCaseClick={id => navigate(`/cases/${id}`)}
          />
        )}

        <p className="pb-4 text-center text-xs text-slate-500">
          Figures reflect the register at the time of loading.
        </p>
      </PageShell>
    </DashboardLayout>
  );
}

/**
 * The two short lists that sit under the charts: the six most recently
 * registered matters, and the six most overdue. Both are already capped by the
 * server query, so nothing further is sliced here.
 */
function RecentMatters({
  recent,
  overdue,
  closureMedianDays,
  onCaseClick,
}: {
  recent: {
    id: number;
    caseNumber: string;
    teacherName: string;
    province: string;
    status: string;
    dateReceived: Date;
  }[];
  overdue: {
    id: number;
    caseNumber: string;
    teacherName: string;
    province: string;
    status: string;
    dueDate: Date | null;
  }[];
  closureMedianDays: number | null;
  onCaseClick: (id: number) => void;
}) {
  const daysOverdue = (due: Date | null) =>
    due
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000)
        )
      : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel
        title="Most recently registered"
        description="The last six matters added."
      >
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing has been registered yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map(item => (
              <li key={item.id}>
                <Link
                  href={`/cases/${item.id}`}
                  className="flex items-center gap-3 py-2 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">
                        {item.caseNumber}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-900">
                        {item.teacherName}
                      </span>
                      <StatusTag status={item.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.province} · received{" "}
                      {new Date(item.dateReceived).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
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
      </CardPanel>

      <CardPanel
        title="Most overdue"
        description={
          closureMedianDays !== null
            ? `Matters closed took a median of ${closureMedianDays} days.`
            : "Matters past their due date."
        }
      >
        {overdue.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing is past its due date.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {overdue.map(item => {
              const late = daysOverdue(item.dueDate);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onCaseClick(item.id)}
                    className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">
                          {item.caseNumber}
                        </span>
                        <span className="truncate text-sm font-medium text-slate-900">
                          {item.teacherName}
                        </span>
                        <StatusTag status={item.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.province}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-red-50 px-2 py-0.5 text-xs font-medium tabular-nums text-red-700">
                      {late}d late
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardPanel>
    </div>
  );
}
