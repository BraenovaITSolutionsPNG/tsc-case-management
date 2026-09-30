"use client";

import { CardPanel } from "@/components/DataTable";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { invalidateMatterWrites } from "@/lib/queryInvalidation";
import { cn } from "@/lib/utils";
import { can, refusalFor } from "@shared/access";
import { GOLDEN_RULE_PARTS } from "@shared/delegation";
import { defaultSectionFor, matterTypeValues, provinceValues } from "@shared/matters";
import { ShieldAlert, FilePlus2, ArrowLeft, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Register a new matter: the Registration step.
 *
 * The manual's Golden Rule opens with "no teacher matter should be received
 * without being registered", so this form is deliberately short: what the
 * teacher is, what the matter is, and who is dealing with it. Everything the
 * manual only needs later - the verification, the investigation, the referral -
 * belongs on the matter itself and is captured as the case moves.
 *
 * Two fields are worth a note. The due date is not optional bookkeeping: it
 * turns a matter with no deadline into one that can sit with an officer
 * indefinitely, so the form asks for it up front and says why. The action
 * required is where "no registered matter without an assigned action" is
 * satisfied, which is why the field carries that requirement with it.
 */

type Errors = Partial<
  Record<
    | "dateReceived"
    | "province"
    | "teacherName"
    | "matterType"
    | "matterSummary"
    | "dueDate",
    string
  >
>;

export default function NewCase() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();

  const [dateReceived, setDateReceived] = useState(today());
  const [province, setProvince] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [employeeReference, setEmployeeReference] = useState("");
  const [matterType, setMatterType] = useState("");
  const [matterSummary, setMatterSummary] = useState("");
  const [assignedOfficerName, setAssignedOfficerName] = useState("");
  const [actionRequired, setActionRequired] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [errors, setErrors] = useState<Errors>({});

  const create = trpc.caseManagement.create.useMutation({
    onSuccess: created => {
      // No `id` to give: the server assigned the reference, and the file for
      // this matter is about to be fetched for the first time by the page this
      // navigates to.
      void invalidateMatterWrites(utils);
      if (!created) {
        toast.error("The matter was registered but could not be read back.");
        return;
      }
      toast.success(`${created.caseNumber} registered.`);
      // Straight to the matter: the officer has just created the thing they are
      // about to work on, and the next manual step is verification on it.
      router.push(`/cases/${created.id}`);
    },
    onError: error => toast.error(error.message, { duration: 8000 }),
  });

  if (user && !can(user.role, "matter:register")) {
    return (
      <DashboardLayout>
        <PageShell>
          <DeniedNotice role={user.role} />
        </PageShell>
      </DashboardLayout>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Errors = {};

    if (!dateReceived) next.dateReceived = "Record the date the matter was received.";
    if (!province) next.province = "Choose the province the matter was received in.";
    if (teacherName.trim().length < 2) next.teacherName = "Record the teacher's name.";
    if (!matterType) next.matterType = "Choose the class of matter.";
    if (matterSummary.trim().length < 8) {
      next.matterSummary = "Summarise the matter in a sentence or two.";
    }
    if (dueDate && new Date(dueDate) < new Date(dateReceived || Date.now())) {
      next.dueDate = "The due date cannot be before the date received.";
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    create.mutate({
      dateReceived: new Date(dateReceived),
      province: province as (typeof provinceValues)[number],
      teacherName: teacherName.trim(),
      ...(employeeReference.trim()
        ? { employeeReference: employeeReference.trim() }
        : {}),
      matterType: matterType as (typeof matterTypeValues)[number],
      matterSummary: matterSummary.trim(),
      ...(assignedOfficerName.trim()
        ? { assignedOfficerName: assignedOfficerName.trim() }
        : {}),
      ...(actionRequired.trim() ? { actionRequired: actionRequired.trim() } : {}),
      ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      priority,
    });
  };

  return (
    <DashboardLayout>
      <PageShell>
        <PageHeader
          eyebrow="Registration"
          title="Register a new matter"
          description="Record a teacher matter as it is received. It enters the register at 'Newly received', and the officer taking it is named on the matter."
          icon={FilePlus2}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/cases">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to the register
              </Link>
            </Button>
          }
        />

        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="space-y-5">
            <CardPanel
              title="The teacher"
              description="Who the matter is about, and where it was received."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Date received"
                  required
                  error={errors.dateReceived}
                  hint="No matter should be received without being registered."
                >
                  <Input
                    id="date-received"
                    name="dateReceived"
                    type="date"
                    value={dateReceived}
                    onChange={event => setDateReceived(event.target.value)}
                    className={errors.dateReceived ? "border-red-400" : undefined}
                  />
                </Field>
                <Field
                  label="Province"
                  required
                  error={errors.province}
                  hint="The province the teacher is deployed in."
                >
                  <select
                    id="province"
                    name="province"
                    value={province}
                    onChange={event => setProvince(event.target.value)}
                    className={cn(
                      "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm",
                      errors.province && "border-red-400"
                    )}
                  >
                    <option value="">Choose a province…</option>
                    {provinceValues.map(value => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Teacher's name" required error={errors.teacherName}>
                  <Input
                    id="teacher-name"
                    name="teacherName"
                    value={teacherName}
                    onChange={event => setTeacherName(event.target.value)}
                    placeholder="As it appears on the teacher's record"
                    className={errors.teacherName ? "border-red-400" : undefined}
                  />
                </Field>
                <Field
                  label="Employee reference"
                  hint="Optional. The Commission's own reference for the teacher."
                >
                  <Input
                    id="employee-ref"
                    name="employeeReference"
                    value={employeeReference}
                    onChange={event => setEmployeeReference(event.target.value)}
                    placeholder="e.g. TSC/2019/00417"
                  />
                </Field>
              </div>
            </CardPanel>

            <CardPanel
              title="The matter"
              description="What has been raised, and what class of matter it falls into."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Class of matter"
                  required
                  error={errors.matterType}
                  hint={
                    matterType
                      ? `Normally referred to ${defaultSectionFor(
                          matterType as (typeof matterTypeValues)[number]
                        )}.`
                      : "Appointment, Industrial & General, or Legal."
                  }
                >
                  <select
                    id="matter-type"
                    name="matterType"
                    value={matterType}
                    onChange={event => setMatterType(event.target.value)}
                    className={cn(
                      "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm",
                      errors.matterType && "border-red-400"
                    )}
                  >
                    <option value="">Choose a class…</option>
                    {matterTypeValues.map(value => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Priority"
                  hint="Urgent matters appear in the Director's weekly brief."
                >
                  <select
                    id="priority"
                    name="priority"
                    value={priority}
                    onChange={event =>
                      setPriority(event.target.value as "normal" | "urgent")
                    }
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Field>
              </div>

              <div className="mt-4">
                <Field
                  label="Summary of the matter"
                  required
                  error={errors.matterSummary}
                  hint="What the teacher is asking for or raising, in their terms."
                >
                  <Textarea
                    id="matter-summary"
                    name="matterSummary"
                    value={matterSummary}
                    onChange={event => setMatterSummary(event.target.value)}
                    rows={5}
                    placeholder="The teacher writes that…"
                    className={errors.matterSummary ? "border-red-400" : undefined}
                  />
                </Field>
              </div>
            </CardPanel>

            <CardPanel
              title="Action and deadline"
              description="Who is dealing with this, and by when."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Assigned officer"
                  hint="No registered matter should remain without an owner."
                >
                  <Input
                    id="assigned-officer"
                    name="assignedOfficerName"
                    value={assignedOfficerName}
                    onChange={event => setAssignedOfficerName(event.target.value)}
                    placeholder="Defaults to you if left blank"
                  />
                </Field>
                <Field
                  label="Due date"
                  error={errors.dueDate}
                  hint="A matter should not remain indefinitely with an officer."
                >
                  <Input
                    id="due-date"
                    name="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={event => setDueDate(event.target.value)}
                    className={errors.dueDate ? "border-red-400" : undefined}
                  />
                </Field>
              </div>

              <div className="mt-4">
                <Field
                  label="Action required"
                  hint="No registered matter should remain without an assigned action. Required before the matter moves beyond 'Newly received'."
                >
                  <Textarea
                    id="action-required"
                    name="actionRequired"
                    value={actionRequired}
                    onChange={event => setActionRequired(event.target.value)}
                    rows={3}
                    placeholder="Verify the teacher's deployment record and confirm the…"
                  />
                </Field>
              </div>
            </CardPanel>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Registering…" : "Register matter"}
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href="/cases">Cancel</Link>
              </Button>
            </div>
          </div>

          <aside className="space-y-5">
            <CardPanel title="The Golden Rule">
              <p className="text-xs leading-5 text-slate-600">
                The manual states four things that must always be true of the
                register. This form satisfies the first two at the point of
                registration; the other two are satisfied as the matter moves.
              </p>
              <ul className="mt-3 space-y-2">
                {GOLDEN_RULE_PARTS.map(part => (
                  <li key={part.key} className="flex gap-2 text-xs text-slate-700">
                    <span aria-hidden className="text-teal-600">
                      •
                    </span>
                    {part.text}
                  </li>
                ))}
              </ul>
            </CardPanel>

            <CardPanel title="What happens next">
              <p className="text-xs leading-5 text-slate-600">
                The matter is registered at{" "}
                <span className="font-medium text-slate-800">Newly received</span>{" "}
                and given a case number in the form{" "}
                <span className="font-mono text-[11px] text-slate-700">
                  PM/&lt;province&gt;/&lt;year&gt;/00001
                </span>
                .
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                It will move to{" "}
                <span className="font-medium text-slate-800">
                  Verification required
                </span>{" "}
                once an officer is recorded against it, and from there the matter
                is investigated, referred to a National Section if it falls
                outside the officer's authority, and decided by the
                Commission.
              </p>
            </CardPanel>

            {matterType === "Legal" ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-center gap-2 text-rose-800">
                  <Scale className="h-4 w-4" aria-hidden />
                  <p className="text-sm font-semibold">Legal matter</p>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-rose-800">
                  A legal matter takes a distinct path, and provincial
                  officers must not give their own legal opinions. The Director
                  must be notified before it leaves the province.
                </p>
              </div>
            ) : null}
          </aside>
        </form>
      </PageShell>
    </DashboardLayout>
  );
}

/** Labelled control with an optional hint and error, matching the admin form. */
function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-red-700">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

function DeniedNotice({ role }: { role: NonNullable<Parameters<typeof refusalFor>[0]> }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-6 py-10 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-rose-600" />
      <h1 className="mt-4 text-xl font-semibold text-rose-950">
        Registration is not open to your role
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-rose-800">
        {refusalFor(role, "matter:register")}
      </p>
      <Button asChild variant="secondary" className="mt-5">
        <Link href="/cases">Back to the register</Link>
      </Button>
    </div>
  );
}

/** Today as `yyyy-mm-dd`, in local time rather than UTC. */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}
