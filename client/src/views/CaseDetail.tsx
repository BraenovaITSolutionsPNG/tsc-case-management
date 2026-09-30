"use client";

import { CardPanel } from "@/components/DataTable";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { ReferMatterDialog } from "@/components/ReferMatterDialog";
import { StatusTag } from "@/components/StatusIcon";
import { TabPanel, TabStrip, TabStripItem } from "@/components/TabStrip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { invalidateMatterWrites } from "@/lib/queryInvalidation";
import { cn } from "@/lib/utils";
import { can, refusalFor, type Capability } from "@shared/access";
import {
  CASE_BRIEF_FIELDS,
  CASEFILE_MAX_BYTES,
  DOCUMENT_CLASSES,
  ESCALATION_LEVELS,
  MAX_ESCALATION_LEVEL,
  GOLDEN_RULE_PARTS,
  REFERRAL_CRITERIA,
  escalationLabel,
  isCasefileMimeType,
  type CasefileMimeType,
} from "@shared/delegation";
import type { MatterType } from "@shared/matters";
import {
  CLOSED_STATUSES,
  STATUS_LABELS,
  STATUS_VALUES,
  isOverdue,
  isOpenStatus,
  type CaseStatus,
} from "@shared/statuses";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Flag,
  Gavel,
  Landmark,
  Loader2,
  Paperclip,
  Scale,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * A single matter, and the whole of the manual on one screen.
 *
 * The manual is a workflow, and this screen is laid out along it rather than
 * around a database table: what the matter is, the action on it, where it has
 * been, where it has gone, the case file behind it, and the brief the Director
 * reads. Each panel names the requirement it serves so an officer can see that
 * the thing they are looking at is the thing the manual asks for.
 *
 * Two design decisions are worth stating, because both are about what the client
 * is allowed to claim:
 *
 *  - Every action is gated on the capability the *server* enforces, using
 *    `can(role, ...)`. A control the officer cannot use is shown disabled with
 *    the reason rather than hidden, because "I cannot do this" and "this does
 *    not exist" are different answers and only one of them is true.
 *  - The Golden Rule is not checked here before saving. The server runs
 *    `checkGoldenRule` and refuses, and this screen renders the refusal as it
 *    comes back. A second implementation of the rule in the interface would be a
 *    third thing to keep in step, and it would be the one that drifts.
 */

export default function CaseDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  const query = trpc.caseManagement.getById.useQuery(
    { id },
    { enabled: Number.isInteger(id) && id > 0 }
  );

  const [referOpen, setReferOpen] = useState(false);

  /**
   * The refresh the tabs below call through `onChanged`, for the mutations that
   * live two or three components down and so have no cache proxy of their own.
   *
   * It is the same mapping the mutations on this screen use directly, which is
   * the point: a note added to the activity trail and an edit made in the header
   * both dirty exactly the same reads, and neither has to remember which.
   */
  const invalidate = () => {
    void invalidateMatterWrites(utils, id);
  };

  if (!Number.isInteger(id) || id <= 0) {
    return (
      <DashboardLayout>
        <PageShell>
          <NotAMatter heading="That is not a matter reference" />
        </PageShell>
      </DashboardLayout>
    );
  }

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <PageShell>
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </PageShell>
      </DashboardLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <DashboardLayout>
        <PageShell>
          <NotAMatter
            heading="This matter could not be opened"
            detail={query.error?.message}
            onRetry={() => void utils.caseManagement.getById.invalidate({ id })}
          />
        </PageShell>
      </DashboardLayout>
    );
  }

  const matter = query.data;
  const role = user?.role ?? null;
  const overdue = isOverdue(matter.status, matter.dueDate);
  const documents = matter.documents ?? [];
  const referrals = matter.referrals ?? [];
  const events = matter.events ?? [];

  /**
   * Closure checklist. The manual requires a complete case file before a
   * matter is closed; which of the required classes are still absent is shown
   * on the case file tab rather than only being enforced at the moment of
   * closure, so the gap is visible while it can still be filled.
   */
  const presentClasses = new Set(documents.map(doc => doc.documentClass));
  const missingRequired = DOCUMENT_CLASSES.filter(
    item => item.requiredForClosure && !presentClasses.has(item.key)
  );

  return (
    <DashboardLayout>
      <PageShell>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/cases">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to the register
          </Link>
        </Button>

        <PageHeader
          eyebrow={matter.caseNumber}
          title={matter.teacherName}
          description={matter.matterSummary}
          icon={FileText}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <StatusTag status={matter.status} short={false} />
              {matter.decisionRequired ? (
                <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700">
                  <Flag className="h-3.5 w-3.5" aria-hidden />
                  For the Director
                </span>
              ) : null}
              {matter.priority === "urgent" ? (
                <span className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                  Urgent
                </span>
              ) : null}
              {overdue ? (
                <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Past due date
                </span>
              ) : null}
            </div>
          }
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
          <Tabs defaultValue="matter" className="min-w-0">
            <TabStrip>
              <TabStripItem value="matter">The matter</TabStripItem>
              <TabStripItem value="activity">
                Activity
                {events.length ? (
                  <span className="ml-1.5 text-xs text-slate-400">
                    {events.length}
                  </span>
                ) : null}
              </TabStripItem>
              <TabStripItem value="referrals">
                Referrals
                {referrals.length ? (
                  <span className="ml-1.5 text-xs text-slate-400">
                    {referrals.length}
                  </span>
                ) : null}
              </TabStripItem>
              <TabStripItem value="file">
                Case file
                {missingRequired.length ? (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
                    {missingRequired.length}
                  </span>
                ) : null}
              </TabStripItem>
              <TabStripItem value="brief">Case brief</TabStripItem>
            </TabStrip>

            <TabsContent value="matter" className="mt-4">
              <MatterTab id={matter.id} role={role} />
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <ActivityTab
                caseId={matter.id}
                events={events}
                canAddEvent={can(role, "matter:update")}
                onChanged={invalidate}
              />
            </TabsContent>

            <TabsContent value="referrals" className="mt-4">
              <ReferralsTab
                referrals={referrals}
                role={role}
                onChanged={invalidate}
                onRefer={() => setReferOpen(true)}
              />
            </TabsContent>

            <TabsContent value="file" className="mt-4">
              <CaseFileTab
                caseId={matter.id}
                documents={documents}
                missingRequired={missingRequired}
                role={role}
                onChanged={invalidate}
              />
            </TabsContent>

            <TabsContent value="brief" className="mt-4">
              <BriefTab id={matter.id} role={role} onChanged={invalidate} />
            </TabsContent>
          </Tabs>

          <aside className="space-y-5">
            <CardPanel title="At a glance">
              <dl className="space-y-2.5 text-sm">
                <Row label="Class of matter" value={matter.matterType} />
                <Row label="Province" value={matter.province} />
                <Row
                  label="Received"
                  value={formatDate(matter.dateReceived)}
                />
                <Row
                  label="Officer"
                  value={
                    matter.assignedOfficerName ?? (
                      <span className="text-amber-700">Unassigned</span>
                    )
                  }
                />
                <Row
                  label="Due"
                  value={
                    matter.dueDate ? (
                      <span className={overdue ? "font-medium text-red-700" : undefined}>
                        {formatDate(matter.dueDate)}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row
                  label="Escalation"
                  value={`${escalationLabel(matter.escalationLevel)} (level ${matter.escalationLevel})`}
                />
                <Row
                  label="Referred to"
                  value={matter.sectionReferred ?? "—"}
                />
              </dl>
            </CardPanel>

            <CardPanel title="Action required" description="The assigned action.">
              {matter.actionRequired ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {matter.actionRequired}
                </p>
              ) : (
                <p className="text-sm text-red-700">
                  No action recorded. The Golden Rule requires an assigned
                  action before a matter moves beyond &quot;Newly received&quot;.
                </p>
              )}
            </CardPanel>

            {!isOpenStatus(matter.status) ? (
              <CardPanel title="Recorded outcome" description="No matter closed without an outcome.">
                {matter.outcome ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {matter.outcome}
                  </p>
                ) : (
                  <p className="text-sm text-red-700">No outcome recorded.</p>
                )}
                {matter.dateClosed ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Closed {formatDate(matter.dateClosed)}
                    {matter.decidedByName
                      ? ` — decided by ${matter.decidedByName}`
                      : ""}
                    {matter.communicatedByName
                      ? `, communicated by ${matter.communicatedByName}`
                      : ""}
                    .
                  </p>
                ) : null}
              </CardPanel>
            ) : null}

            <CardPanel title="The Golden Rule">
              <ul className="space-y-2">
                {GOLDEN_RULE_PARTS.map(part => (
                  <li key={part.key} className="flex gap-2 text-xs text-slate-700">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600"
                      aria-hidden
                    />
                    {part.text}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                These are enforced on the server when the matter is changed, not
                merely advised here.
              </p>
            </CardPanel>
          </aside>
        </div>

        <ReferMatterDialog
          caseId={matter.id}
          matterType={matter.matterType as MatterType}
          open={referOpen}
          onOpenChange={setReferOpen}
        />
      </PageShell>
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------- The matter

/**
 * The work panel: status, officer, deadline, priority, escalation, and the two
 * Director instruments. Each control is enabled by the capability the server
 * enforces on the matching mutation, and disabled controls say why.
 */
function MatterTab({
  id,
  role,
}: {
  id: number;
  role: Parameters<typeof can>[0];
}) {
  const utils = trpc.useUtils();
  const query = trpc.caseManagement.getById.useQuery({ id });
  const matter = query.data;

  const update = trpc.caseManagement.update.useMutation({
    onSuccess: () => {
      void invalidateMatterWrites(utils, id);
      toast.success("Matter updated.");
    },
    onError: error => toast.error(error.message, { duration: 9000 }),
  });

  const flag = trpc.caseManagement.flagForDirector.useMutation({
    onSuccess: () => {
      void invalidateMatterWrites(utils, id);
      toast.success("Director flag updated.");
    },
    onError: error => toast.error(error.message, { duration: 8000 }),
  });

  /**
   * The Golden Rule refuses a closure without a recorded outcome, a date closed
   * and a record of who communicated it. Those three have no other home on this
   * screen, so choosing "Resolved" or "Closed" opens the closure form instead of
   * firing a bare status change the server would refuse: the officer is asked for
   * the three things at the moment they are needed, rather than being handed a
   * list of violations naming fields they were never offered.
   */
  const [closingTo, setClosingTo] = useState<CaseStatus | null>(null);

  if (!matter) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const canUpdate = can(role, "matter:update");
  const canEscalate = can(role, "matter:escalate");
  const canFlag = can(role, "matter:flag");

  const send = (fields: Record<string, unknown>) => {
    update.mutate({ id, ...fields } as Parameters<typeof update.mutate>[0]);
  };

  return (
    <div className="space-y-5">
      <CardPanel
        title="Status and action"
        description="The standard status codes, as the Director monitors them."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Gate
            capability="matter:update"
            role={role}
            label="Status"
            disabled={!canUpdate}
          >
            <select
              id="status"
              name="status"
              value={closingTo ?? matter.status}
              onChange={event => {
                const next = event.target.value as CaseStatus;
                if (CLOSED_STATUSES.includes(next)) {
                  setClosingTo(next);
                  return;
                }
                setClosingTo(null);
                send({ status: next });
              }}
              disabled={!canUpdate}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
            >
              {STATUS_VALUES.map(value => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </Gate>

          <Gate
            capability="matter:update"
            role={role}
            label="Assigned officer"
            disabled={!canUpdate}
          >
            <Input
              id="assigned-officer"
              name="assignedOfficerName"
              defaultValue={matter.assignedOfficerName ?? ""}
              disabled={!canUpdate}
              placeholder="Unassigned"
              onBlur={event => {
                const next = event.target.value.trim();
                if (next !== (matter.assignedOfficerName ?? "")) {
                  // `null`, not `undefined`: undefined means "leave this alone"
                  // and would be stripped before the write, so clearing the
                  // officer would report success and change nothing.
                  send({ assignedOfficerName: next || null });
                }
              }}
            />
          </Gate>

          <Gate
            capability="matter:update"
            role={role}
            label="Due date"
            disabled={!canUpdate}
            hint="A matter should not remain indefinitely with an officer."
          >
            <Input
              id="due-date"
              name="dueDate"
              type="date"
              defaultValue={toDateInput(matter.dueDate)}
              disabled={!canUpdate}
              onChange={event =>
                send({
                  dueDate: event.target.value
                    ? new Date(event.target.value)
                    : null,
                })
              }
            />
          </Gate>

          <Gate
            capability="matter:update"
            role={role}
            label="Priority"
            disabled={!canUpdate}
            hint="Urgent matters appear in the Director's weekly brief."
          >
            <select
              id="priority"
              name="priority"
              value={matter.priority}
              disabled={!canUpdate}
              onChange={event =>
                send({ priority: event.target.value as "normal" | "urgent" })
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
            >
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </Gate>
        </div>

        <div className="mt-4">
          <Gate
            capability="matter:update"
            role={role}
            label="Action required"
            disabled={!canUpdate}
            hint="Required before the matter moves beyond 'Newly received', and before it can be closed."
          >
            <Textarea
              id="action-required"
              name="actionRequired"
              defaultValue={matter.actionRequired ?? ""}
              disabled={!canUpdate}
              rows={3}
              onBlur={event => {
                const next = event.target.value.trim();
                if (next !== (matter.actionRequired ?? "")) {
                  send({ actionRequired: next || null });
                }
              }}
            />
          </Gate>
        </div>

        {!canUpdate ? (
          <p className="mt-3 text-xs text-slate-500">
            {refusalFor(role, "matter:update")}
          </p>
        ) : null}
      </CardPanel>

      {closingTo ? (
        <ClosureForm
          id={id}
          target={closingTo}
          currentOutcome={matter.outcome ?? ""}
          currentDateClosed={matter.dateClosed ?? null}
          onCancel={() => setClosingTo(null)}
          onClosed={() => setClosingTo(null)}
        />
      ) : null}

      <CardPanel
        title="Escalation"
        description="A matter should not remain indefinitely with an officer. The ladder runs from the officer up to the Commission."
      >
        <Gate
          capability="matter:escalate"
          role={role}
          label="Escalation level"
          disabled={!canEscalate}
          hint={ESCALATION_LEVELS[matter.escalationLevel]?.description}
        >
          <select
            id="escalation-level"
            name="escalationLevel"
            value={matter.escalationLevel}
            disabled={!canEscalate}
            onChange={event => send({ escalationLevel: Number(event.target.value) })}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-60"
          >
            {ESCALATION_LEVELS.filter(level => level.level <= MAX_ESCALATION_LEVEL).map(
              level => (
                <option key={level.level} value={level.level}>
                  {level.level} — {level.label}
                </option>
              )
            )}
          </select>
        </Gate>
        {!canEscalate ? (
          <p className="mt-3 text-xs text-slate-500">
            {refusalFor(role, "matter:escalate")}
          </p>
        ) : null}
      </CardPanel>

      <CardPanel
        title="For the Director"
        description="Matters requiring the Director's attention. Flagging is how a matter reaches the Director's desk."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={matter.decisionRequired ? "secondary" : "outline"}
            size="sm"
            disabled={!canFlag || flag.isPending}
            onClick={() =>
              flag.mutate({ id, required: !matter.decisionRequired })
            }
          >
            <Flag className="mr-2 h-4 w-4" />
            {matter.decisionRequired
              ? "Remove from the Director's attention"
              : "Flag for the Director"}
          </Button>
          <span className="text-xs text-slate-600">
            {matter.decisionRequired
              ? "Currently in the Director's queue."
              : "Not currently flagged."}
          </span>
        </div>
        {!canFlag ? (
          <p className="mt-3 text-xs text-slate-500">
            {refusalFor(role, "matter:flag")}
          </p>
        ) : null}

        {matter.decisionRequired && can(role, "matter:decide") ? (
          <DecisionForm id={id} currentOutcome={matter.outcome ?? ""} />
        ) : matter.decisionRequired ? (
          <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
            {refusalFor(role, "matter:decide")}
          </p>
        ) : null}
      </CardPanel>
    </div>
  );
}

/**
 * §17 "no matter should be closed without a recorded outcome."
 *
 * Closing is the one status change that cannot be a single field, because the
 * Golden Rule attaches three facts to it: the outcome, the date closed, and who
 * communicated the outcome to the teacher. They are sent as one request with the
 * status, so the matter never passes through a half-closed state in which the
 * status says closed and the record behind it says nothing.
 */
function ClosureForm({
  id,
  target,
  currentOutcome,
  currentDateClosed,
  onCancel,
  onClosed,
}: {
  id: number;
  target: CaseStatus;
  currentOutcome: string;
  currentDateClosed: Date | string | null;
  onCancel: () => void;
  onClosed: () => void;
}) {
  const utils = trpc.useUtils();
  const [outcome, setOutcome] = useState(currentOutcome);
  const [dateClosed, setDateClosed] = useState(
    toDateInput(currentDateClosed) ?? todayInputValue()
  );
  const [communicatedByName, setCommunicatedByName] = useState("");

  const close = trpc.caseManagement.update.useMutation({
    onSuccess: () => {
      void invalidateMatterWrites(utils, id);
      toast.success(
        target === "CLS" ? "Matter closed." : "Matter resolved and closed."
      );
      onClosed();
    },
    onError: error => toast.error(error.message, { duration: 9000 }),
  });

  const ready =
    outcome.trim().length >= 8 && dateClosed.length > 0 && communicatedByName.trim().length >= 2;

  return (
    <CardPanel
      title={`Close the matter as "${STATUS_LABELS[target]}"`}
      description="§17 Golden Rule: no matter may be closed without a recorded outcome, a date closed, and a record of who communicated it to the teacher."
    >
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-700">
            Outcome / decision or advice given
          </span>
          <Textarea
            id="closure-outcome"
            name="outcome"
            value={outcome}
            onChange={event => setOutcome(event.target.value)}
            rows={3}
            placeholder="What was decided, and what the teacher was told."
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">
              Date closed
            </span>
            <Input
              id="closure-date"
              name="dateClosed"
              type="date"
              value={dateClosed}
              onChange={event => setDateClosed(event.target.value)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">
              Communicated to the teacher by
            </span>
            <Input
              id="closure-communicated-by"
              name="communicatedByName"
              value={communicatedByName}
              onChange={event => setCommunicatedByName(event.target.value)}
              placeholder="Officer who conveyed the outcome"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!ready || close.isPending}
            onClick={() =>
              close.mutate({
                id,
                status: target,
                outcome: outcome.trim(),
                dateClosed: new Date(dateClosed),
                communicatedByName: communicatedByName.trim(),
              })
            }
          >
            {close.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {target === "CLS" ? "Close matter" : "Resolve and close matter"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {!ready ? (
            <span className="text-xs text-slate-500">
              All three are required before the matter can be closed.
            </span>
          ) : null}
        </div>
      </div>
    </CardPanel>
  );
}

/** The Commission decides; the Director records what was decided. */
function DecisionForm({
  id,
  currentOutcome,
}: {
  id: number;
  currentOutcome: string;
}) {
  const utils = trpc.useUtils();
  const [outcome, setOutcome] = useState(currentOutcome);
  const [decidedByName, setDecidedByName] = useState("");

  const decide = trpc.caseManagement.commissionerUpdate.useMutation({
    onSuccess: () => {
      void invalidateMatterWrites(utils, id);
      toast.success("Decision recorded.");
      setDecidedByName("");
    },
    onError: error => toast.error(error.message, { duration: 9000 }),
  });

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
        <Gavel className="h-3.5 w-3.5" aria-hidden />
        Record the Commission&apos;s decision
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-700">
            Decided by (Director&apos;s name)
          </span>
          <Input
            id="decided-by"
            name="decidedByName"
            value={decidedByName}
            onChange={event => setDecidedByName(event.target.value)}
            placeholder="Director, Provincial Matters"
          />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-700">
          The decision or advice given
        </span>
        <Textarea
          id="decision-outcome"
          name="outcome"
          value={outcome}
          onChange={event => setOutcome(event.target.value)}
          rows={3}
        />
      </label>
      <Button
        size="sm"
        disabled={decide.isPending}
        onClick={() =>
          decide.mutate({ id, decidedByName: decidedByName.trim(), outcome: outcome.trim() })
        }
      >
        {decide.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Record decision
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- Activity

/** Who did what, and when: the accountability trail for this matter. */
function ActivityTab({
  caseId,
  events,
  canAddEvent,
  onChanged,
}: {
  caseId: number;
  events: {
    id: number;
    eventType: string;
    note: string;
    actorName: string | null;
    createdAt: Date | string;
  }[];
  canAddEvent: boolean;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const add = trpc.caseManagement.addEvent.useMutation({
    onSuccess: () => {
      onChanged();
      setNote("");
      toast.success("Note added to the matter.");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <CardPanel
      title="Activity"
      description="Every office that handles a matter stays identifiable."
    >
      {canAddEvent ? (
        <div className="mb-4 space-y-2 border-b border-slate-100 pb-4">
          <Textarea
            id="activity-note"
            name="activityNote"
            value={note}
            onChange={event => setNote(event.target.value)}
            rows={2}
            placeholder="Record what you have done on this matter…"
          />
          <Button
            size="sm"
            disabled={add.isPending || note.trim().length < 2}
            onClick={() =>
              add.mutate({ caseId, eventType: "note", note: note.trim() })
            }
          >
            Add note
          </Button>
        </div>
      ) : null}

      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          Nothing has been recorded against this matter yet.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {events.map(event => (
            <li key={event.id} className="relative">
              <span
                className="absolute -left-[26px] top-1.5 h-2 w-2 rounded-full bg-slate-300"
                aria-hidden
              />
              <p className="text-sm text-slate-800">{event.note}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {event.actorName ?? "Unknown officer"} ·{" "}
                {formatDateTime(event.createdAt)} · {event.eventType.replace(/_/g, " ")}
              </p>
            </li>
          ))}
        </ol>
      )}
    </CardPanel>
  );
}

// ---------------------------------------------------------------- Referrals

/** Follow-up: what the National Sections have been asked, and what came back. */
function ReferralsTab({
  referrals,
  role,
  onChanged,
  onRefer,
}: {
  referrals: ReferralRecord[];
  role: Parameters<typeof can>[0];
  onChanged: () => void;
  onRefer: () => void;
}) {
  const canRefer = can(role, "matter:refer");
  const canFollowUp = can(role, "referral:followUp");

  return (
    <div className="space-y-5">
      <CardPanel
        title="Referrals"
        description="The National Section holding primary authority, and why the matter was referred."
        action={
          canRefer ? (
            <Button size="sm" onClick={onRefer}>
              <Landmark className="mr-2 h-4 w-4" />
              Refer to a National Section
            </Button>
          ) : null
        }
      >
        {!canRefer ? (
          <p className="mb-3 text-xs text-slate-500">
            {refusalFor(role, "matter:refer")}
          </p>
        ) : null}

        {referrals.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            This matter has not been referred to a National Section.
          </p>
        ) : (
          <div className="space-y-4">
            {referrals.map(referral => (
              <ReferralCard
                key={referral.id}
                referral={referral}
                canFollowUp={canFollowUp}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </CardPanel>
    </div>
  );
}

/**
 * A referral as the matter file carries it.
 *
 * Declared once and used by both the list and the card. It was declared twice,
 * which is how the §6 Director notification and the §8 statement set came to be
 * collected by the referral dialog, stored by the server, and then dropped on the
 * floor by a prop type that no longer mentioned them.
 */
type ReferralRecord = {
  id: number;
  destination: string;
  reason: string;
  criteria: string | null;
  isLegal: boolean;
  status: string;
  referredAt: Date | string;
  responseDueDate: Date | string | null;
  responseReceivedAt: Date | string | null;
  responseSummary: string | null;
  referredByName: string | null;
  // §6 the Director is notified before a legal matter leaves the province.
  directorNotifiedName: string | null;
  directorNotifiedAt: Date | string | null;
  // §8 the four statements an Industrial and General referral must carry.
  statementClaim: string | null;
  statementVerified: string | null;
  statementUnresolved: string | null;
  statementAdviceRequired: string | null;
};

function ReferralCard({
  referral,
  canFollowUp,
  onChanged,
}: {
  referral: ReferralRecord;
  canFollowUp: boolean;
  onChanged: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [open, setOpen] = useState(false);

  const respond = trpc.caseManagement.recordReferralResponse.useMutation({
    onSuccess: () => {
      onChanged();
      setSummary("");
      setOpen(false);
      toast.success("Response recorded.");
    },
    onError: error => toast.error(error.message, { duration: 8000 }),
  });

  const overdue =
    referral.status === "pending" &&
    !!referral.responseDueDate &&
    new Date(referral.responseDueDate).getTime() < Date.now();

  return (
    <div
      className={cn(
        "rounded-md border p-4",
        overdue ? "border-red-200 bg-red-50/40" : "border-slate-200"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            {referral.destination}
            {referral.isLegal ? (
              <span className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                <Scale className="h-3 w-3" aria-hidden />
                Legal
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Referred {formatDate(referral.referredAt)}
            {referral.referredByName ? ` by ${referral.referredByName}` : ""}
            {" · due "}
            {formatDate(referral.responseDueDate)}
          </p>
        </div>
        <span
          className={cn(
            "rounded border px-2 py-0.5 text-xs font-medium",
            referral.status === "received"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : overdue
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
          )}
        >
          {overdue
            ? "Response overdue"
            : referral.status === "received"
              ? "Response received"
              : "Awaiting response"}
        </span>
      </div>

      <p className="mt-2.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {referral.reason}
      </p>

      {referral.criteria ? (
        <p className="mt-2 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Trigger:</span>{" "}
          {referral.criteria
            .split(",")
            .map(key => {
              // Resolved back through the manual's own table rather than
              // prettified, so the trigger reads as the clause the officer
              // actually invoked and not as its storage key.
              const found = REFERRAL_CRITERIA.find(
                item => item.key === key.trim()
              );
              return found ? found.text : key.replace(/_/g, " ");
            })
            .join("; ")}
        </p>
      ) : null}

      {/* §6 the Director is notified before a legal matter leaves the province.
          Collected at referral time and kept on the file, because the manual
          makes the notification part of the referral rather than a courtesy. */}
      {referral.isLegal ? (
        <p className="mt-2 text-xs text-slate-500">
          <span className="font-medium text-slate-600">§6 Director notified:</span>{" "}
          {referral.directorNotifiedName
            ? `${referral.directorNotifiedName} on ${formatDate(referral.directorNotifiedAt)}`
            : "Not recorded"}
        </p>
      ) : null}

      {/* §8 the statement set an Industrial and General referral has to carry:
          what is claimed, what the province verified, what is unresolved, and
          the decision or advice required. The National Section cannot advise on
          the province's duty without these, and they were being collected and
          then never shown to anyone - including the officer who wrote them. */}
      {referral.statementClaim ||
      referral.statementVerified ||
      referral.statementUnresolved ||
      referral.statementAdviceRequired ? (
        <dl className="mt-3 grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          {(
            [
              ["Claim", referral.statementClaim],
              ["Verified", referral.statementVerified],
              ["Unresolved", referral.statementUnresolved],
              ["Advice required", referral.statementAdviceRequired],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-slate-600">{label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-[13px] leading-5 text-slate-700">
                {value || "—"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {referral.responseSummary ? (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-700">
            Response received {formatDate(referral.responseReceivedAt)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {referral.responseSummary}
          </p>
        </div>
      ) : canFollowUp && referral.status !== "received" ? (
        <div className="mt-3">
          {open ? (
            <div className="space-y-2">
              <Textarea
                id="referral-response"
                name="referralResponse"
                value={summary}
                onChange={event => setSummary(event.target.value)}
                rows={3}
                placeholder="What the National Section replied…"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={respond.isPending || summary.trim().length < 4}
                  onClick={() =>
                    respond.mutate({
                      referralId: referral.id,
                      responseSummary: summary.trim(),
                    })
                  }
                >
                  {respond.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Record response
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Record the National Section&apos;s response
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Case file

/** Eleven classes of document, and the checklist before closure. */
function CaseFileTab({
  caseId,
  documents,
  missingRequired,
  role,
  onChanged,
}: {
  caseId: number;
  documents: {
    id: number;
    documentClass: string;
    title: string;
    note: string | null;
    fileKey: string | null;
    fileName: string | null;
    fileSize: number | null;
    loggedByName: string | null;
    createdAt: Date | string;
  }[];
  missingRequired: { key: string; label: string }[];
  role: Parameters<typeof can>[0];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const canWrite = can(role, "file:write");

  return (
    <div className="space-y-5">
      {missingRequired.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3.5">
          <p className="text-sm font-medium text-amber-900">
            {missingRequired.length} required class
            {missingRequired.length === 1 ? "" : "es"} still missing before this
            matter can be closed
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-800">
            {missingRequired.map(item => (
              <li key={item.key}>• {item.label}</li>
            ))}
          </ul>
        </div>
      ) : documents.length ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3.5">
          <p className="text-sm font-medium text-emerald-900">
            Every required class of document is on the file.
          </p>
        </div>
      ) : null}

      <CardPanel
        title="Case file"
        description="The complete case file. A class can be recorded before the scan is attached."
        action={
          canWrite ? (
            <Button size="sm" onClick={() => setAdding(value => !value)}>
              <Upload className="mr-2 h-4 w-4" />
              {adding ? "Cancel" : "Add an item"}
            </Button>
          ) : null
        }
      >
        {!canWrite ? (
          <p className="mb-3 text-xs text-slate-500">{refusalFor(role, "file:write")}</p>
        ) : null}

        {adding && canWrite ? (
          <AddDocumentForm
            caseId={caseId}
            onDone={() => {
              setAdding(false);
              onChanged();
            }}
          />
        ) : null}

        <div className={cn(adding && "mt-4 border-t border-slate-100 pt-4")}>
          {documents.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nothing has been filed against this matter yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {documents.map(document => (
                <DocumentRow
                  key={document.id}
                  caseId={caseId}
                  document={document}
                  canWrite={canWrite}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </div>
      </CardPanel>
    </div>
  );
}

function AddDocumentForm({
  caseId,
  onDone,
}: {
  caseId: number;
  onDone: () => void;
}) {
  const [documentClass, setDocumentClass] = useState(DOCUMENT_CLASSES[0].key);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const add = trpc.caseManagement.addDocument.useMutation({
    onSuccess: () => {
      toast.success("Filed against the matter.");
      onDone();
    },
    onError: cause => setError(cause.message),
  });

  const submit = async () => {
    if (title.trim().length < 2) {
      setError("Give the item a title.");
      return;
    }
    // Narrowed client-side to avoid a wasted round trip, but the server
    // re-sniffs the bytes and is the actual authority on what a file is.
    if (file && !isCasefileMimeType(file.type)) {
      setError(
        "Case documents must be PDF, an image, Word or Excel, or plain text."
      );
      return;
    }
    if (file && file.size > CASEFILE_MAX_BYTES) {
      setError(
        `Case documents must be ${CASEFILE_MAX_BYTES / 1024 / 1024} MB or smaller. That one is ${(file.size / 1024 / 1024).toFixed(1)} MB.`
      );
      return;
    }
    setError("");
    let data: string | undefined;
    if (file) {
      try {
        data = await readAsBase64(file);
      } catch {
        setError("That file could not be read.");
        return;
      }
    }
    await add.mutateAsync({
      caseId,
      documentClass: documentClass as never,
      title: title.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(file && data
        ? {
            data,
            mimeType: file.type as CasefileMimeType,
            fileName: file.name,
          }
        : {}),
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-700">Class</span>
          <select
            id="document-class"
            name="documentClass"
            value={documentClass}
            onChange={event => setDocumentClass(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
          >
            {DOCUMENT_CLASSES.map(item => (
              <option key={item.key} value={item.key}>
                {item.label}
                {item.requiredForClosure ? " (required)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-700">Title</span>
          <Input
            id="document-title"
            name="documentTitle"
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Letter to the Appointments Section"
          />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-700">
          Attach a file (optional)
        </span>
        <Input
          id="document-file"
          name="documentFile"
          type="file"
          onChange={event => setFile(event.target.files?.[0] ?? null)}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
        />
        <span className="block text-xs text-slate-500">
          PDF, image, Word, Excel or plain text, up to{" "}
          {CASEFILE_MAX_BYTES / 1024 / 1024} MB. A class may be recorded now and
          the scan attached later.
        </span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-700">Note (optional)</span>
        <Textarea
          id="document-note"
          name="documentNote"
          value={note}
          onChange={event => setNote(event.target.value)}
          rows={2}
        />
      </label>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <Button size="sm" onClick={submit} disabled={add.isPending}>
        {add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        File against the matter
      </Button>
    </div>
  );
}

function DocumentRow({
  caseId,
  document,
  canWrite,
  onChanged,
}: {
  caseId: number;
  document: {
    id: number;
    documentClass: string;
    title: string;
    note: string | null;
    fileKey: string | null;
    fileName: string | null;
    fileSize: number | null;
    loggedByName: string | null;
    createdAt: Date | string;
  };
  canWrite: boolean;
  onChanged: () => void;
}) {
  const remove = trpc.caseManagement.removeDocument.useMutation({
    onSuccess: () => {
      onChanged();
      toast.success("Item removed from the case file.");
    },
    onError: error => toast.error(error.message),
  });

  const label =
    DOCUMENT_CLASSES.find(item => item.key === document.documentClass)?.label ??
    document.documentClass;

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          {document.title}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {label}
          {document.fileSize
            ? ` · ${(document.fileSize / 1024).toFixed(0)} KB`
            : " · recorded, no file attached"}
          {" · "}
          {document.loggedByName ?? "Unknown officer"} ·{" "}
          {formatDate(document.createdAt)}
        </p>
        {document.note ? (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
            {document.note}
          </p>
        ) : null}
        {document.fileKey ? (
          <a
            href={`/manus-storage/${document.fileKey}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline"
          >
            <Paperclip className="h-3 w-3" aria-hidden />
            {document.fileName ?? "Open the file"}
          </a>
        ) : null}
      </div>
      {canWrite ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={remove.isPending}
          aria-label={`Remove ${document.title}`}
          onClick={() =>
            remove.mutate({ id: document.id, caseId })
          }
        >
          <Trash2 className="h-4 w-4 text-slate-400" />
        </Button>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------- Brief

/** The short case report prepared before a matter reaches the Director. */
function BriefTab({
  id,
  role,
  onChanged,
}: {
  id: number;
  role: Parameters<typeof can>[0];
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.caseManagement.getById.useQuery({ id });
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [decisionRequired, setDecisionRequired] = useState(false);
  const [error, setError] = useState("");

  const save = trpc.caseManagement.saveBrief.useMutation({
    onSuccess: () => {
      void invalidateMatterWrites(utils, id);
      onChanged();
      setError("");
      toast.success("Case brief saved.");
    },
    onError: cause => setError(cause.message),
  });

  const matter = query.data;
  const canWrite = can(role, "brief:write");

  /**
   * Seeded from the stored brief once it arrives, so a saved brief is not
   * overwritten by a default-valued form if the officer opens and saves again.
   */
  if (matter && values === null) {
    setValues({
      issue: matter.briefIssue ?? "",
      background: matter.briefBackground ?? "",
      actionTaken: matter.briefActionTaken ?? "",
      currentPosition: matter.briefCurrentPosition ?? "",
      issueRequiringDecision: matter.briefIssueRequiringDecision ?? "",
      recommendation: matter.briefRecommendation ?? "",
    });
    setDecisionRequired(matter.decisionRequired);
  }

  if (!matter || !values) {
    return <Skeleton className="h-72 rounded-lg" />;
  }

  return (
    <CardPanel
      title="Case brief"
      description="Before presenting a matter to the Director, prepare a short case report. Tick the box to place it in the Director's attention queue."
    >
      {!canWrite ? (
        <p className="mb-3 text-xs text-slate-500">{refusalFor(role, "brief:write")}</p>
      ) : null}

      {matter.briefPreparedByName ? (
        <p className="mb-3 text-xs text-slate-500">
          Prepared by {matter.briefPreparedByName} on{" "}
          {formatDate(matter.briefPreparedAt)}.
        </p>
      ) : null}

      <div className="space-y-4">
        {CASE_BRIEF_FIELDS.map(field => (
          <label key={field.key} className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">{field.label}</span>
            <Textarea
              // One field per brief section, each addressable by its own key so
              // the browser and any assistive technology can tell the six apart.
              id={`brief-${field.key}`}
              name={field.key}
              value={values[field.key] ?? ""}
              disabled={!canWrite}
              rows={3}
              onChange={event =>
                setValues(current => ({
                  ...(current ?? {}),
                  [field.key]: event.target.value,
                }))
              }
            />
            <span className="block text-xs text-slate-500">{field.hint}</span>
          </label>
        ))}
      </div>

      <label className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
        <input
          id="brief-decision-required"
          name="decisionRequired"
          type="checkbox"
          checked={decisionRequired}
          disabled={!canWrite}
          onChange={event => setDecisionRequired(event.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <span className="text-sm text-slate-700">
          This matter requires the Director&apos;s attention
        </span>
      </label>

      {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}

      {canWrite ? (
        <Button
          className="mt-4"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              id,
              issue: values.issue ?? "",
              background: values.background ?? "",
              actionTaken: values.actionTaken ?? "",
              currentPosition: values.currentPosition ?? "",
              issueRequiringDecision: values.issueRequiringDecision ?? "",
              recommendation: values.recommendation ?? "",
              decisionRequired,
            })
          }
        >
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save the case brief
        </Button>
      ) : null}
    </CardPanel>
  );
}

// ---------------------------------------------------------------- Utilities

/** A label/value pair, with the value allowed to be marked up. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * Wraps a control that the officer's role may not be permitted to use, showing
 * the server's own refusal wording underneath. Hiding it instead would leave
 * the officer to wonder whether the platform is missing the feature.
 */
function Gate({
  capability,
  role,
  label,
  hint,
  disabled,
  children,
}: {
  capability: Capability;
  role: Parameters<typeof can>[0];
  label: string;
  hint?: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      {disabled ? (
        <span className="block text-xs text-slate-400">
          {refusalFor(role, capability)}
        </span>
      ) : null}
    </label>
  );
}

function NotAMatter({
  heading,
  detail,
  onRetry,
}: {
  heading: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
      <FileText className="mx-auto h-9 w-9 text-slate-300" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-slate-900">{heading}</h1>
      {detail ? <p className="mt-1.5 text-sm text-slate-600">{detail}</p> : null}
      <div className="mt-5 flex justify-center gap-2">
        <Button asChild variant="secondary">
          <Link href="/cases">Back to the register</Link>
        </Button>
        {onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Base64 without the data-URL prefix, which is what the mutation schema wants. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/** Today, as a date input wants it. A matter is closed on the day it is closed. */
function todayInputValue() {
  return toDateInput(new Date());
}
