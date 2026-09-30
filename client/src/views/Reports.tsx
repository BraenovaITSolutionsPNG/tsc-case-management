"use client";

import {
  CardPanel,
  DenseBody,
  DenseCell,
  DenseHead,
  DenseHeader,
  DenseRow,
  DenseTable,
  NumCell,
  NumHead,
  StatTable,
} from "@/components/DataTable";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusIcon";
import { TabStrip, TabStripItem } from "@/components/TabStrip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { can, refusalFor } from "@shared/access";
import { GOLDEN_RULE_PARTS } from "@shared/delegation";
import { STATUS_LABELS, type CaseStatus } from "@shared/statuses";
import {
  BarChart3,
  CalendarRange,
  FileBarChart,
  Printer,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

/**
 * The Director's reporting set.
 *
 * Four reports, matching the manual's own cadence rather than the interface's
 * convenience: the one-page weekly brief, the monthly provincial matters
 * report, the quarterly performance report, and the officer performance
 * report. Golden Rule compliance sits with them because a
 * performance report that quietly excluded the breaches would be reporting on
 * the wrong thing.
 *
 * All five are gated on the single `report:view` capability. The manual has the
 * Professional Assistant to the Director preparing the weekly, monthly and
 * quarterly reports, so the Assistant is the lowest tier that reaches this
 * screen - the Director receives them rather than being the only one who can
 * produce them.
 *
 * A quarterly figure on its own is a count, not a performance report, so every
 * quarterly headline is shown against the quarter before it.
 */

export default function Reports() {
  const { data: user } = trpc.auth.me.useQuery();

  if (user && !can(user.role, "report:view")) {
    return (
      <DashboardLayout>
        <PageShell>
          <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-6 py-12 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-rose-600" />
            <h1 className="mt-4 text-xl font-semibold text-rose-950">
              The reporting set is not open to your role
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-rose-800">
              {refusalFor(user.role, "report:view")}
            </p>
            <Button asChild variant="secondary" className="mt-5">
              <Link href="/">Back to the dashboard</Link>
            </Button>
          </div>
        </PageShell>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageShell>
        <PageHeader
          eyebrow="Reporting set"
          title="Reports"
          description="The weekly brief, the monthly and quarterly reports, and the compliance view — the reports the manual has the office produce."
          icon={FileBarChart}
        />

        <Tabs defaultValue="weekly">
          <TabStrip>
            <TabStripItem value="weekly">Weekly brief</TabStripItem>
            <TabStripItem value="monthly">Monthly</TabStripItem>
            <TabStripItem value="quarterly">Quarterly</TabStripItem>
            <TabStripItem value="officers">Officers</TabStripItem>
            <TabStripItem value="compliance">Golden Rule</TabStripItem>
          </TabStrip>

          <TabsContent value="weekly" className="mt-5">
            <WeeklyBriefTab />
          </TabsContent>
          <TabsContent value="monthly" className="mt-5">
            <MonthlyTab />
          </TabsContent>
          <TabsContent value="quarterly" className="mt-5">
            <QuarterlyTab />
          </TabsContent>
          <TabsContent value="officers" className="mt-5">
            <OfficersTab />
          </TabsContent>
          <TabsContent value="compliance" className="mt-5">
            <ComplianceTab />
          </TabsContent>
        </Tabs>
      </PageShell>
    </DashboardLayout>
  );
}

/** Printed as well as read: the manual describes a brief the Director takes away. */
function PrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="mr-2 h-4 w-4" />
      Print
    </Button>
  );
}

function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-10 rounded" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Weekly

/**
 * The one-page Director's weekly brief, sections A to F. The section
 * letters are the manual's, kept in order, because the Director reads against
 * the manual and a differently-ordered brief would be harder to use, not
 * easier.
 */
function WeeklyBriefTab() {
  const query = trpc.reports.weeklyBrief.useQuery();
  const utils = trpc.useUtils();

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) {
    return <ErrorPanel message={query.error?.message} onRetry={() => void utils.reports.weeklyBrief.invalidate()} />;
  }

  const brief = query.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Week ending <span className="font-medium text-slate-900">{brief.period}</span>
        </p>
        <PrintButton />
      </div>

      <StatTable
        items={[
          { label: "Matters open", value: brief.totals.open, detail: "Still in progress" },
          {
            label: "Past their due date",
            value: brief.totals.overdue,
            detail: "Should not be held indefinitely",
            tone: brief.totals.overdue ? "text-red-700" : undefined,
          },
          {
            label: "Urgent or escalated",
            value: brief.totals.urgent,
            detail: "Section A below",
            tone: brief.totals.urgent ? "text-amber-700" : undefined,
          },
          {
            label: "Decisions required",
            value: brief.totals.decisions,
            detail: "For the Director",
            tone: brief.totals.decisions ? "text-violet-700" : undefined,
          },
        ]}
      />

      <CardPanel
        title="A. Urgent matters"
        description="Matters marked urgent, and matters escalated for delay."
      >
        {brief.urgent.length === 0 ? (
          <Empty text="No urgent or escalated matters." />
        ) : (
          <DenseTable className="min-w-[860px]">
            <DenseHeader>
              <DenseRow>
                <DenseHead>Case</DenseHead>
                <DenseHead>Teacher</DenseHead>
                <DenseHead>Province</DenseHead>
                <DenseHead>Status</DenseHead>
                <DenseHead>Action required</DenseHead>
              </DenseRow>
            </DenseHeader>
            <DenseBody>
              {brief.urgent.map(item => (
                <DenseRow key={item.id}>
                  <CaseCell id={item.id} caseNumber={item.caseNumber} />
                  <DenseCell>{item.teacherName}</DenseCell>
                  <DenseCell className="text-slate-600">{item.province}</DenseCell>
                  <DenseCell>
                    <StatusTag status={item.status} />
                  </DenseCell>
                  <DenseCell className="max-w-[280px] text-xs text-slate-600">
                    {item.actionRequired ?? "—"}
                  </DenseCell>
                </DenseRow>
              ))}
            </DenseBody>
          </DenseTable>
        )}
      </CardPanel>

      <CardPanel
        title="B. Legal matters"
        description="What the Legal Section is being asked to do, and how long it has been outstanding."
      >
        {brief.legal.length === 0 ? (
          <Empty text="No legal matters are outstanding." />
        ) : (
          <DenseTable className="min-w-[620px]">
            <DenseHeader>
              <DenseRow>
                <DenseHead>Case</DenseHead>
                <DenseHead>Status</DenseHead>
                <DenseHead>Legal action required</DenseHead>
                <NumHead>Days outstanding</NumHead>
              </DenseRow>
            </DenseHeader>
            <DenseBody>
              {brief.legal.map(item => (
                <DenseRow key={item.id}>
                  <CaseCell id={item.id} caseNumber={item.caseNumber} />
                  <DenseCell>
                    <StatusTag status={item.status} />
                  </DenseCell>
                  <DenseCell className="max-w-[320px] text-xs text-slate-600">
                    {item.legalActionRequired ?? "—"}
                  </DenseCell>
                  <NumCell
                    className={
                      item.daysOutstanding > 30
                        ? "font-medium text-red-700"
                        : "text-slate-600"
                    }
                  >
                    {item.daysOutstanding ?? "—"}
                  </NumCell>
                </DenseRow>
              ))}
            </DenseBody>
          </DenseTable>
        )}
      </CardPanel>

      <div className="grid gap-5 lg:grid-cols-2">
        <CategoryPanel
          title="C. Appointment matters"
          category={brief.appointment}
        />
        <CategoryPanel
          title="D. Industrial and General matters"
          category={brief.industrial}
        />
      </div>

      <CardPanel
        title="E. Overdue matters"
        description="Matters past their due date, longest outstanding first."
      >
        {brief.overdue.length === 0 ? (
          <Empty text="Nothing is past its due date." />
        ) : (
          <DenseTable className="min-w-[620px]">
            <DenseHeader>
              <DenseRow>
                <DenseHead>Case</DenseHead>
                <DenseHead>Teacher</DenseHead>
                <DenseHead>Officer</DenseHead>
                <NumHead>Days outstanding</NumHead>
              </DenseRow>
            </DenseHeader>
            <DenseBody>
              {brief.overdue.map(item => (
                <DenseRow key={item.id}>
                  <CaseCell id={item.id} caseNumber={item.caseNumber} />
                  <DenseCell>{item.teacherName}</DenseCell>
                  <DenseCell className="text-slate-600">
                    {item.assignedOfficerName ?? "Unassigned"}
                  </DenseCell>
                  <NumCell className="font-medium text-red-700">
                    {item.daysOutstanding}
                  </NumCell>
                </DenseRow>
              ))}
            </DenseBody>
          </DenseTable>
        )}
      </CardPanel>

      <CardPanel
        title="F. Matters requiring a decision"
        description="What the Director is being asked to decide on."
      >
        {brief.decisionsRequired.length === 0 ? (
          <Empty text="Nothing is waiting on a decision." />
        ) : (
          <DenseTable className="min-w-[860px]">
            <DenseHeader>
              <DenseRow>
                <DenseHead>Case</DenseHead>
                <DenseHead>Teacher</DenseHead>
                <DenseHead>Type</DenseHead>
                <DenseHead>Issue requiring decision</DenseHead>
                <DenseHead>Recommendation</DenseHead>
                <NumHead>Days</NumHead>
              </DenseRow>
            </DenseHeader>
            <DenseBody>
              {brief.decisionsRequired.map(item => (
                <DenseRow key={item.id}>
                  <CaseCell id={item.id} caseNumber={item.caseNumber} />
                  <DenseCell>{item.teacherName}</DenseCell>
                  <DenseCell className="text-slate-600">{item.matterType}</DenseCell>
                  <DenseCell className="max-w-[260px] text-xs text-slate-600">
                    {item.issueRequiringDecision ?? "—"}
                  </DenseCell>
                  <DenseCell className="max-w-[220px] text-xs text-slate-600">
                    {item.recommendation ?? "—"}
                  </DenseCell>
                  <NumCell className="text-slate-600">
                    {item.daysOutstanding ?? "—"}
                  </NumCell>
                </DenseRow>
              ))}
            </DenseBody>
          </DenseTable>
        )}
      </CardPanel>
    </div>
  );
}

/** Sections C and D: the same three counts, for one class of matter. */
function CategoryPanel({
  title,
  category,
}: {
  title: string;
  category: { new: unknown[]; pending: unknown[]; resolved: unknown[] };
}) {
  return (
    <CardPanel title={title} description="New, pending and resolved.">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: "New", count: category.new.length, tone: "text-sky-700" },
          { label: "Pending", count: category.pending.length, tone: "text-violet-700" },
          { label: "Resolved", count: category.resolved.length, tone: "text-emerald-700" },
        ].map(item => (
          <div key={item.label} className="rounded-md border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              {item.label}
            </p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${item.tone}`}>
              {item.count}
            </p>
          </div>
        ))}
      </div>
    </CardPanel>
  );
}

// ---------------------------------------------------------------- Monthly

/** The monthly provincial matters report, with a period picker. */
function MonthlyTab() {
  const [month, setMonth] = useState(currentMonthKey());
  const query = trpc.reports.monthly.useQuery({ month });
  const utils = trpc.useUtils();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden />
          Month
        </label>
        <Input
          id="report-month"
          name="month"
          type="month"
          value={month}
          onChange={event => setMonth(event.target.value)}
          className="h-8 w-40"
        />
        <PrintButton />
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.error || !query.data ? (
        <ErrorPanel message={query.error?.message} onRetry={() => void utils.reports.monthly.invalidate()} />
      ) : (
        <>
          <StatTable
            items={[
              { label: "Received", value: query.data.totals.received, detail: "Matters registered this month" },
              { label: "Closed", value: query.data.totals.closed, detail: "Matters concluded this month" },
              {
                label: "Outstanding",
                value: query.data.totals.outstanding,
                detail: "Still open province-wide",
              },
              {
                label: "Escalated",
                value: query.data.totals.escalated,
                detail: "At any level above the officer",
                tone: query.data.totals.escalated ? "text-amber-700" : undefined,
              },
            ]}
          />

          <CardPanel
            title={query.data.label}
            description="Matters received in the month, by province and by class."
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <Breakdown
                title="By province"
                rows={query.data.byProvince.map(row => ({
                  key: row.province,
                  label: row.province,
                  count: row.count,
                }))}
              />
              <Breakdown
                title="By class of matter"
                rows={query.data.byCategory.map(row => ({
                  key: row.matterType,
                  label: row.matterType,
                  count: row.count,
                }))}
              />
            </div>
          </CardPanel>

          <CardPanel
            title="The register, by status"
            description="Every matter in the province, wherever it has reached."
          >
            <Breakdown
              title=""
              rows={query.data.byStatus.map(row => ({
                key: row.status,
                label: STATUS_LABELS[row.status as CaseStatus] ?? row.status,
                count: row.count,
              }))}
            />
          </CardPanel>

          <CardPanel
            title="Escalated matters"
            description="Matters that have moved up the ladder."
          >
            {query.data.escalated.length === 0 ? (
              <Empty text="No matter has been escalated." />
            ) : (
              <DenseTable className="min-w-[420px]">
                <DenseHeader>
                  <DenseRow>
                    <DenseHead>Case</DenseHead>
                    <DenseHead>Status</DenseHead>
                    <NumHead>Escalation level</NumHead>
                  </DenseRow>
                </DenseHeader>
                <DenseBody>
                  {query.data.escalated.map(item => (
                    <DenseRow key={item.id}>
                      <CaseCell id={item.id} caseNumber={item.caseNumber} />
                      <DenseCell>
                        <StatusTag status={item.status} />
                      </DenseCell>
                      <NumCell className="text-slate-600">{item.escalationLevel}</NumCell>
                    </DenseRow>
                  ))}
                </DenseBody>
              </DenseTable>
            )}
          </CardPanel>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Quarterly

/** Quarterly performance, every headline against the quarter before. */
function QuarterlyTab() {
  const [quarter, setQuarter] = useState("");
  const quarters = trpc.reports.quarters.useQuery();
  const query = trpc.reports.quarterly.useQuery(
    quarter ? { quarter } : undefined
  );
  const utils = trpc.useUtils();

  const selected = quarter || quarters.data?.[0]?.key || "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden />
          Quarter
        </label>
        <select
          id="report-quarter"
          name="quarter"
          value={selected}
          onChange={event => setQuarter(event.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {(quarters.data ?? []).map(item => (
            <option key={item.key} value={item.key}>
              {item.label} — {item.range}
            </option>
          ))}
        </select>
        <PrintButton />
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.error || !query.data ? (
        <ErrorPanel message={query.error?.message} onRetry={() => void utils.reports.quarterly.invalidate()} />
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {query.data.label}{" "}
            <span className="text-slate-500">({query.data.range})</span>, compared
            with {query.data.comparedWith}.
          </p>

          <StatTable
            items={[
              {
                label: "Received",
                value: query.data.totals.received,
                detail: was(query.data.totals.received, query.data.previous.received),
                tone: deltaTone(
                  query.data.totals.received,
                  query.data.previous.received
                ),
              },
              {
                label: "Closed",
                value: query.data.totals.closed,
                detail: was(query.data.totals.closed, query.data.previous.closed),
                tone: deltaTone(
                  query.data.totals.closed,
                  query.data.previous.closed
                ),
              },
              {
                label: "Closure rate",
                value: `${query.data.totals.closureRate}%`,
                detail: "Of this quarter's intake, closed inside it",
              },
              {
                label: "Median days to close",
                value: query.data.totals.medianDaysToClose ?? "—",
                detail:
                  query.data.previous.medianDaysToClose !== null
                    ? `was ${query.data.previous.medianDaysToClose}`
                    : "No comparable figure last quarter",
              },
            ]}
          />

          <CardPanel
            title="Month by month"
            description="A quarter that looks flat can be three very different months."
          >
            <div className="grid grid-cols-3 gap-3">
              {query.data.months.map(month => (
                <div key={month.key} className="rounded-md border border-slate-200 p-3 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    {month.label}
                  </p>
                  <p className="mt-1.5 text-sm text-slate-700">
                    <span className="tabular-nums font-semibold">{month.received}</span> in
                    <span className="mx-1 text-slate-400">/</span>
                    <span className="tabular-nums font-semibold">{month.closed}</span> out
                  </p>
                </div>
              ))}
            </div>
          </CardPanel>

          <div className="grid gap-5 lg:grid-cols-2">
            <CardPanel title="By province">
              <Breakdown
                title=""
                rows={query.data.byProvince.map(row => ({
                  key: row.province,
                  label: row.province,
                  count: row.count,
                }))}
              />
            </CardPanel>
            <CardPanel title="By class of matter">
              <Breakdown
                title=""
                rows={query.data.byCategory.map(row => ({
                  key: row.matterType,
                  label: row.matterType,
                  count: row.count,
                }))}
              />
            </CardPanel>
          </div>

          <CardPanel
            title="Officer performance in the quarter"
            description="Scoped to work done inside the period: a matter received in the quarter counts for whoever received it."
          >
            {query.data.officers.length === 0 ? (
              <Empty text="No officer activity was recorded in this quarter." />
            ) : (
              <DenseTable fixed className="min-w-[860px]">
                <DenseHeader>
                  <DenseRow>
                    <DenseHead>Officer</DenseHead>
                    <NumHead>Received</NumHead>
                    <NumHead>Closed</NumHead>
                    <NumHead>Open</NumHead>
                    <NumHead>Overdue</NumHead>
                    <NumHead>Escalations</NumHead>
                    <NumHead>No action</NumHead>
                    <NumHead>Median days</NumHead>
                  </DenseRow>
                </DenseHeader>
                <DenseBody>
                  {query.data.officers.map(row => (
                    <DenseRow key={row.officer}>
                      <DenseCell className="font-medium">{row.officer}</DenseCell>
                      <NumCell>{row.received}</NumCell>
                      <NumCell>{row.closed}</NumCell>
                      <NumCell>{row.open}</NumCell>
                      <NumCell
                        className={row.overdue ? "font-medium text-red-700" : undefined}
                      >
                        {row.overdue}
                      </NumCell>
                      <NumCell
                        className={row.escalations ? "text-amber-700" : undefined}
                      >
                        {row.escalations}
                      </NumCell>
                      <NumCell
                        className={row.withoutAction ? "font-medium text-red-700" : undefined}
                      >
                        {row.withoutAction}
                      </NumCell>
                      <NumCell className="text-slate-600">
                        {row.medianTurnaroundDays ?? "—"}
                      </NumCell>
                    </DenseRow>
                  ))}
                </DenseBody>
              </DenseTable>
            )}
          </CardPanel>

          <CardPanel
            title="Golden Rule compliance"
            description="Whether the province is currently breaching the principle."
          >
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm text-slate-700">
                <span className="text-2xl font-semibold tabular-nums text-slate-900">
                  {query.data.compliance.compliant}
                </span>{" "}
                of {query.data.compliance.total} matters comply
              </p>
              {query.data.compliance.breaches ? (
                <p className="text-sm font-medium text-red-700">
                  {query.data.compliance.breaches} breaching
                </p>
              ) : null}
            </div>
          </CardPanel>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Officers

/** The accountability view: "every office handling a matter should be
 * identifiable". */
function OfficersTab() {
  const query = trpc.reports.officerPerformance.useQuery();
  const utils = trpc.useUtils();

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) {
    return <ErrorPanel message={query.error?.message} onRetry={() => void utils.reports.officerPerformance.invalidate()} />;
  }

  const rows = query.data;
  const worstOverdue = Math.max(0, ...rows.map(row => row.overdueRate));

  return (
    <CardPanel
      title="Provincial officer performance"
      description="The accountability view, province-wide rather than for one quarter."
    >
      <div className="mb-4 flex justify-end">
        <PrintButton />
      </div>
      {rows.length === 0 ? (
        <Empty text="No officer has handled a matter yet." />
      ) : (
        <DenseTable fixed className="min-w-[1000px]">
          <DenseHeader>
            <DenseRow>
              <DenseHead>Officer</DenseHead>
              <NumHead>Received</NumHead>
              <NumHead>Held</NumHead>
              <NumHead>Open</NumHead>
              <NumHead>Closed</NumHead>
              <NumHead>Overdue</NumHead>
              <NumHead>Overdue rate</NumHead>
              <NumHead>Escalations</NumHead>
              <NumHead>No action</NumHead>
              <NumHead>Avg days</NumHead>
            </DenseRow>
          </DenseHeader>
          <DenseBody>
            {rows.map(row => (
              <DenseRow key={row.officer}>
                <DenseCell className="font-medium">{row.officer}</DenseCell>
                <NumCell>{row.received}</NumCell>
                <NumCell>{row.held}</NumCell>
                <NumCell>{row.open}</NumCell>
                <NumCell>{row.closed}</NumCell>
                <NumCell className={row.overdue ? "font-medium text-red-700" : undefined}>
                  {row.overdue}
                </NumCell>
                <NumCell
                  className={
                    row.overdueRate === worstOverdue && row.overdueRate > 0
                      ? "font-medium text-red-700"
                      : "text-slate-600"
                  }
                >
                  {row.overdueRate}%
                </NumCell>
                <NumCell className={row.escalations ? "text-amber-700" : undefined}>
                  {row.escalations}
                </NumCell>
                <NumCell
                  className={row.withoutAction ? "font-medium text-red-700" : undefined}
                >
                  {row.withoutAction}
                </NumCell>
                <NumCell className="text-slate-600">
                  {row.avgTurnaroundDays ?? "—"}
                </NumCell>
              </DenseRow>
            ))}
          </DenseBody>
        </DenseTable>
      )}
    </CardPanel>
  );
}

// ---------------------------------------------------------------- Compliance

/** The Golden Rule as a register-wide check, not guidance in the manual. */
function ComplianceTab() {
  const query = trpc.reports.goldenRule.useQuery();
  const utils = trpc.useUtils();

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) {
    return <ErrorPanel message={query.error?.message} onRetry={() => void utils.reports.goldenRule.invalidate()} />;
  }

  const { compliant, total, breaches } = query.data;
  const rate = total ? Math.round((compliant / total) * 100) : 100;

  return (
    <div className="space-y-5">
      <CardPanel
        title="The Golden Rule"
        description="The manual states four things that must always be true of the register."
      >
        <ul className="space-y-2">
          {GOLDEN_RULE_PARTS.map(part => (
            <li key={part.key} className="flex gap-2 text-sm text-slate-700">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
              {part.text}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-700">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">
            {rate}%
          </span>{" "}
          of the {total} matter{total === 1 ? "" : "s"} on the register currently
          comply.
        </p>
      </CardPanel>

      <CardPanel
        title="Breaches"
        description="Each matter listed against the part of the rule it is failing."
      >
        {breaches.length === 0 ? (
          <div className="py-8 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500" aria-hidden />
            <p className="mt-2 text-sm text-slate-600">
              No matter on the register is currently breaching the Golden Rule.
            </p>
          </div>
        ) : (
          <DenseTable className="min-w-[520px]">
            <DenseHeader>
              <DenseRow>
                <DenseHead>Case</DenseHead>
                <DenseHead>Part of the rule not being met</DenseHead>
              </DenseRow>
            </DenseHeader>
            <DenseBody>
              {breaches.map(row => (
                <DenseRow key={row.id}>
                  <CaseCell id={row.id} caseNumber={row.caseNumber} />
                  <DenseCell>
                    <ul className="space-y-1">
                      {row.parts.map(part => (
                        <li key={part} className="text-sm text-red-700">
                          {GOLDEN_RULE_PARTS.find(item => item.key === part)?.text ?? part}
                        </li>
                      ))}
                    </ul>
                  </DenseCell>
                </DenseRow>
              ))}
            </DenseBody>
          </DenseTable>
        )}
      </CardPanel>
    </div>
  );
}

// ---------------------------------------------------------------- Utilities

function CaseCell({ id, caseNumber }: { id: number; caseNumber: string }) {
  return (
    <DenseCell>
      <Link
        href={`/cases/${id}`}
        className="font-mono text-xs font-medium text-teal-800 hover:underline"
      >
        {caseNumber}
      </Link>
    </DenseCell>
  );
}

/** A labelled bar list, scaled to the largest count so the shape is readable. */
function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return (
    <div>
      {title ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
          {title}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-slate-700">{row.label}</span>
                <span className="shrink-0 tabular-nums font-medium text-slate-900">
                  {row.count}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-teal-600/70"
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{text}</p>;
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="py-8 text-center">
      <BarChart3 className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
      <p className="mt-2 text-sm text-slate-600">
        The report could not be loaded. {message}
      </p>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>
        <TrendingUp className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

/** "was 14" — the comparison a quarterly headline needs to mean anything. */
function was(current: number, previous: number) {
  const delta = current - previous;
  if (delta === 0) return `no change on ${previous}`;
  return `${delta > 0 ? "up" : "down"} from ${previous}`;
}

/** Green for movement in the right direction, red for the other. */
function deltaTone(current: number, previous: number) {
  if (current === previous) return undefined;
  return current > previous ? "text-emerald-700" : "text-amber-700";
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
