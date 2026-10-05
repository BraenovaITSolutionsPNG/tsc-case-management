"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { parseDateInput } from "@/lib/dateInput";
import { invalidateMatterWrites } from "@/lib/queryInvalidation";
import { cn } from "@/lib/utils";
import {
  INDUSTRIAL_REFERRAL_STATEMENTS,
  NATIONAL_SECTIONS,
  REFERRAL_CRITERIA,
  isLegalReferral,
} from "@shared/delegation";
import { defaultSectionFor, type MatterType } from "@shared/matters";
import { Landmark, Loader2, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Referral: triggers, and the Industrial and General statement set.
 *
 * Three things make this form more than a destination picker, and each is
 * enforced on the server as well as here:
 *
 *  - The officer records *which* trigger applied. Free-texting the reason is
 *    what the manual rules out, because "referred for advice" is not
 *    distinguishable from "referred because we could not decide it".
 *  - Any legal trigger routes the matter to the Legal Section whatever the
 *    category says, and the Director must be recorded as notified. That is why
 *    the legal notice field appears the moment a legal trigger is ticked, rather
 *    than after the officer has tried to submit without it.
 *  - An Industrial and General referral must state four things. The server
 *    refuses one that does not, so the form shows the four as soon as that
 *    destination is chosen.
 *
 * The destination defaults to the National Section the matter's category maps to, so
 * the common case is two ticks and a due date.
 */

export function ReferMatterDialog({
  caseId,
  matterType,
  open,
  onOpenChange,
}: {
  caseId: number;
  matterType: MatterType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const [destination, setDestination] = useState(defaultSectionFor(matterType));
  const [criteria, setCriteria] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [responseDueDate, setResponseDueDate] = useState("");
  const [directorNotifiedName, setDirectorNotifiedName] = useState("");
  const [statements, setStatements] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const legal = isLegalReferral(criteria);
  const isIndustrial = destination === "Industrial and General";

  // A legal referral goes to the Legal Section regardless of what the
  // officer picked, and the form says so rather than silently overwriting the
  // choice and leaving the officer wondering why their selection moved.
  useEffect(() => {
    if (legal && destination !== "Legal Section")
      setDestination("Legal Section");
  }, [legal, destination]);

  const refer = trpc.caseManagement.refer.useMutation({
    onSuccess: () => {
      void invalidateMatterWrites(utils, caseId);
      toast.success("Matter referred.");
      reset();
      onOpenChange(false);
    },
    onError: error => toast.error(error.message, { duration: 9000 }),
  });

  const reset = () => {
    setDestination(defaultSectionFor(matterType));
    setCriteria([]);
    setReason("");
    setResponseDueDate("");
    setDirectorNotifiedName("");
    setStatements({});
    setErrors({});
  };

  const toggleCriterion = (key: string) =>
    setCriteria(current =>
      current.includes(key)
        ? current.filter(item => item !== key)
        : [...current, key]
    );

  const submit = () => {
    const next: Record<string, string> = {};
    if (!destination) next.destination = "Choose the National Section.";
    if (!criteria.length) {
      // The trigger is the point of the referral.
      next.criteria =
        "Select at least one reason. The officer must record the trigger that took the matter outside their authority.";
    }
    if (reason.trim().length < 8) {
      next.reason =
        "Describe the matter being referred (at least 8 characters).";
    }
    if (!responseDueDate) {
      // No referred matter should remain without follow-up.
      next.responseDueDate =
        "Set a response due date. No referred matter should remain without follow up.";
    }
    if (legal && !directorNotifiedName.trim()) {
      next.directorNotifiedName =
        "Record the Director, Provincial Matters, as notified before the matter goes to the Legal Section.";
    }
    if (isIndustrial) {
      for (const field of INDUSTRIAL_REFERRAL_STATEMENTS) {
        if (!statements[field.key]?.trim()) {
          next[`statement-${field.key}`] =
            "An Industrial and General referral must state all four.";
        }
      }
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    refer.mutate({
      caseId,
      destination,
      reason: reason.trim(),
      criteria,
      // `parseDateInput` rather than `new Date(...)`, which happens to agree with it
      // today — both read `YYYY-MM-DD` as UTC midnight, the same reading the
      // server's `z.coerce.date()` applies. Naming it says the deadline is a
      // calendar date rather than an instant, and keeps the single place that
      // decides what a calendar date means.
      ...(responseDueDate
        ? { responseDueDate: parseDateInput(responseDueDate) ?? undefined }
        : {}),
      ...(directorNotifiedName.trim()
        ? { directorNotifiedName: directorNotifiedName.trim() }
        : {}),
      ...(isIndustrial
        ? {
            statementClaim: statements.claim?.trim(),
            statementVerified: statements.verified?.trim(),
            statementUnresolved: statements.unresolved?.trim(),
            statementAdviceRequired: statements.adviceRequired?.trim(),
          }
        : {}),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refer to a National Section</DialogTitle>
          <DialogDescription>
            Record the trigger that took this matter outside your delegated
            authority. The matter leaves the province and is tracked against the
            response date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Field
            label="National Section"
            required
            error={errors.destination}
            hint="The National Section holding primary technical authority for this subject matter."
          >
            <select
              id="refer-destination"
              name="destination"
              value={destination}
              onChange={event => setDestination(event.target.value)}
              className={cn(
                "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm",
                errors.destination && "border-red-400"
              )}
            >
              {NATIONAL_SECTIONS.map(section => (
                <option key={section.key} value={section.label}>
                  {section.label}
                </option>
              ))}
            </select>
          </Field>

          <fieldset>
            <legend className="text-xs font-medium text-slate-700">
              Reason for referral <span className="text-red-600">*</span>
            </legend>
            <p className="mt-1 text-xs text-slate-500">
              Tick every trigger that applies. A legal trigger routes the matter
              to the Legal Section.
            </p>
            <div className="mt-2 space-y-1.5">
              {REFERRAL_CRITERIA.map(criterion => {
                const checked = criteria.includes(criterion.key);
                return (
                  <label
                    key={criterion.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded border p-2 text-xs transition-colors",
                      checked
                        ? "border-teal-300 bg-teal-50/60 text-teal-900"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50",
                      criterion.legalOnly && !checked && "border-rose-100"
                    )}
                  >
                    <input
                      // One box per trigger, each addressable by its own key
                      // but sharing a name: they are a single multi-valued
                      // answer, which is how the criteria arrive at the server.
                      id={`refer-criterion-${criterion.key}`}
                      name="criteria"
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCriterion(criterion.key)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-input"
                    />
                    <span>
                      {criterion.text}
                      {criterion.legalOnly ? (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                          Legal
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.criteria ? (
              <p className="mt-1.5 text-xs text-red-700">{errors.criteria}</p>
            ) : null}
          </fieldset>

          {legal ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                <Scale className="h-3.5 w-3.5" aria-hidden />
                Legal referral
              </p>
              <p className="mt-1 text-xs leading-5 text-rose-800">
                Provincial officers must not give their own legal opinions. The
                Director, Provincial Matters, is notified before the matter
                leaves the province.
              </p>
              <div className="mt-2.5">
                <Field
                  label="Director notified (name)"
                  required
                  error={errors.directorNotifiedName}
                >
                  <Input
                    id="refer-director-notified"
                    name="directorNotifiedName"
                    value={directorNotifiedName}
                    onChange={event =>
                      setDirectorNotifiedName(event.target.value)
                    }
                    className={
                      errors.directorNotifiedName ? "border-red-400" : undefined
                    }
                  />
                </Field>
              </div>
            </div>
          ) : null}

          <Field
            label="The matter referred"
            required
            error={errors.reason}
            hint="What is being sent, and what is being asked for."
          >
            <Textarea
              id="refer-reason"
              name="reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={3}
              placeholder="The teacher's…"
              className={errors.reason ? "border-red-400" : undefined}
            />
          </Field>

          <Field
            label="Response due date"
            required
            error={errors.responseDueDate}
            hint="The follow-up deadline. Chasing this is the Professional Assistant's standing duty."
          >
            <Input
              id="refer-response-due"
              name="responseDueDate"
              type="date"
              value={responseDueDate}
              onChange={event => setResponseDueDate(event.target.value)}
              className={errors.responseDueDate ? "border-red-400" : undefined}
            />
          </Field>

          {isIndustrial ? (
            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-800">
                Required statement set
              </legend>
              <p className="text-xs text-slate-500">
                An Industrial and General referral must state all four. The
                server refuses one that does not.
              </p>
              <div className="mt-3 space-y-3">
                {INDUSTRIAL_REFERRAL_STATEMENTS.map(field => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required
                    error={errors[`statement-${field.key}`]}
                  >
                    <Textarea
                      // One statement box per §8 field, addressed by its key.
                      id={`refer-statement-${field.key}`}
                      name={`statement${field.key.charAt(0).toUpperCase()}${field.key.slice(1)}`}
                      value={statements[field.key] ?? ""}
                      onChange={event =>
                        setStatements(current => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      rows={2}
                      className={
                        errors[`statement-${field.key}`]
                          ? "border-red-400"
                          : undefined
                      }
                    />
                  </Field>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={refer.isPending}>
            {refer.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Landmark className="mr-2 h-4 w-4" />
            )}
            Refer matter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
