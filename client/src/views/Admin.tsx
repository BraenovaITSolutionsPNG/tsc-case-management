"use client";

import {
  CardPanel,
  DenseBody,
  DenseCell,
  DenseHead,
  DenseHeader,
  DenseRow,
  DenseTable,
  EmptyRow,
  NumCell,
  NumHead,
  StatTable,
} from "@/components/DataTable";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TabStrip, TabStripItem } from "@/components/TabStrip";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import {
  invalidateMatterWrites,
  invalidateUserWrites,
} from "@/lib/queryInvalidation";
import {
  AUDIT_PAGE_SIZE,
  OVERSIGHT_PAGE_SIZE,
  clampPage,
  offsetFor,
  pageCount,
} from "@shared/pagination";
import { cn } from "@/lib/utils";
import {
  STATUS_CLASSES,
  STATUS_SHORT,
  STATUS_VALUES,
  isOpenStatus,
  isOverdue,
  type CaseStatus,
} from "@shared/statuses";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_RANK,
  ROLE_VALUES,
  type Role,
} from "@shared/roles";
import { can, type Capability } from "@shared/access";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Plus,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserCog,
  Users,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

/**
 * The four platform tabs, each carrying the capability the server enforces on
 * the procedures behind it. The strip is built from this list rather than
 * hard-coded, so a tier that holds one of these capabilities sees exactly the
 * tab it is entitled to — the Administrator tier holds platform:oversight and
 * reaches the Oversight tab, which a hard-coded super-administrator check had
 * made unreachable.
 */
const ADMIN_TABS: {
  value: string;
  label: string;
  icon: typeof Users;
  capability: Capability;
}[] = [
  { value: "users", label: "Users", icon: Users, capability: "platform:users" },
  {
    value: "oversight",
    label: "Oversight",
    icon: UserCog,
    capability: "platform:oversight",
  },
  {
    value: "audit",
    label: "Audit trail",
    icon: Activity,
    capability: "platform:audit",
  },
  {
    value: "stats",
    label: "Statistics",
    icon: BarChart3,
    capability: "platform:stats",
  },
];

const roleBadge: Record<Role, string> = {
  staff: "bg-sky-50 text-sky-700 border-sky-200",
  assistant: "bg-teal-50 text-teal-800 border-teal-300",
  commissioner: "bg-violet-50 text-violet-700 border-violet-200",
  admin: "bg-amber-50 text-amber-700 border-amber-200",
  super_admin: "bg-slate-950 text-white border-slate-950",
};

const statusLabel = (value: string) =>
  STATUS_SHORT[value as CaseStatus] ?? value;
const roleLabel = (value: string) => ROLE_LABELS[value as Role] ?? value;

function formatDateTime(value?: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-AU", {
    month: "short",
  });
};

// ---------------------------------------------------------------- Users

function UsersTab({ currentUserId }: { currentUserId: number }) {
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Per-row password reset, for an officer who has lost their credential.
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetValue, setResetValue] = useState("");
  // Delete is a two-step: pick the row, then confirm in the row beneath it. A
  // single click next to "Deactivate" is too easy to hit by accident.
  const [deleting, setDeleting] = useState<number | null>(null);
  // The row whose sign-in name is being edited, and what it is being changed to.
  const [naming, setNaming] = useState<number | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");

  const users = trpc.admin.users.list.useQuery();
  const setRoleMutation = trpc.admin.users.setRole.useMutation({
    onSuccess: () => void invalidateUserWrites(utils),
    onError: e => toast.error(e.message),
  });
  const setActiveMutation = trpc.admin.users.setActive.useMutation({
    onSuccess: () => void invalidateUserWrites(utils),
    onError: e => toast.error(e.message),
  });
  const createMutation = trpc.admin.users.create.useMutation({
    onSuccess: created => {
      void invalidateUserWrites(utils);
      setCreating(false);
      setName("");
      setEmail("");
      setRole("staff");
      setUsername("");
      setPassword("");
      toast.success(
        created
          ? `${created.name} added as ${ROLE_LABELS[created.role]}`
          : "User added"
      );
    },
    onError: e => toast.error(e.message),
  });
  const deleteMutation = trpc.admin.users.delete.useMutation({
    onSuccess: () => {
      void invalidateUserWrites(utils);
      setDeleting(null);
      toast.success("Account deleted.");
    },
    onError: e => toast.error(e.message, { duration: 9000 }),
  });
  const setUsernameMutation = trpc.admin.users.setUsername.useMutation({
    onSuccess: () => {
      void invalidateUserWrites(utils);
      toast.success("Sign-in name updated.");
    },
    onError: e => toast.error(e.message, { duration: 8000 }),
  });
  const setPasswordMutation = trpc.admin.users.setPassword.useMutation({
    onSuccess: () => {
      void invalidateUserWrites(utils);
      setResetFor(null);
      setResetValue("");
      toast.success(
        "Password reset. Give it to the officer over a channel you trust."
      );
    },
    onError: e => toast.error(e.message),
  });

  const rows = users.data ?? [];
  const superAdmins = rows.filter(
    u => u.isActive && u.role === "super_admin"
  ).length;

  return (
    <div className="space-y-5">
      <CardPanel
        title="User accounts"
        description={`${rows.length} account${rows.length === 1 ? "" : "s"} · ${rows.filter(u => u.isActive).length} active · ${superAdmins} super administrator${superAdmins === 1 ? "" : "s"}`}
        action={
          <Button
            onClick={() => setCreating(v => !v)}
            variant={creating ? "secondary" : "default"}
            className="h-9"
          >
            <Plus className="mr-2 h-4 w-4" /> {creating ? "Cancel" : "Add user"}
          </Button>
        }
      >
        {creating ? (
          <form
            className="mb-4 space-y-3"
            onSubmit={event => {
              event.preventDefault();
              createMutation.mutate({
                name,
                email: email || undefined,
                role,
                username: username || undefined,
                password: password || undefined,
              });
            }}
          >
            <div className="grid gap-3 md:grid-cols-[1.2fr_1.2fr_1fr]">
              <Input
                id="new-user-name"
                name="name"
                required
                minLength={2}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Full name"
                className="h-9"
              />
              <Input
                id="new-user-email"
                name="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email (optional)"
                className="h-9"
              />
              <Select value={role} onValueChange={v => setRole(v as Role)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_VALUES.map(value => (
                    <SelectItem key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Username and password belong together: a password is not a
                credential until there is a name to type it against. */}
            <div className="grid gap-3 border-t border-slate-200 pt-3 md:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  Username
                </label>
                <Input
                  id="new-user-username"
                  name="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. j.kumul"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mt-1 h-9 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  Password
                </label>
                <Input
                  id="new-user-password"
                  name="password"
                  type="password"
                  minLength={10}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 10 characters"
                  className="mt-1 h-9"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="h-9"
                >
                  {createMutation.isPending ? "Adding…" : "Add user"}
                </Button>
              </div>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">
              Leave the username and password blank if this person signs in
              through the TSC identity provider.
            </p>
          </form>
        ) : null}

        <div>
          {users.isLoading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-9 rounded" />
              ))}
            </div>
          ) : (
            <>
              {/*
                Fixed layout with stated column widths, and a floor on the
                table so the columns hold that shape instead of being crushed on
                a narrow window.

                The Access column holds three labelled controls. Under
                `table-fixed` a cell is given exactly its share of the table and
                its content cannot shrink below its own width, so a column sized
                for one button is what makes the controls spill sideways over
                the column beside them. Stating the widths, and giving Access
                enough of them to hold what is actually in it, is the fix.
              */}
              <div className="overflow-x-auto">
                <DenseTable fixed className="min-w-[1040px]">
                  <colgroup>
                    <col className="w-[17%]" />
                    <col className="w-[12%]" />
                    <col className="w-[19%]" />
                    <col className="w-[15%]" />
                    <col className="w-[14%]" />
                    <col className="w-[23%]" />
                  </colgroup>
                  <DenseHeader>
                    <DenseRow>
                      <DenseHead>Name</DenseHead>
                      <DenseHead>Username</DenseHead>
                      <DenseHead>Email</DenseHead>
                      <DenseHead>Role</DenseHead>
                      <DenseHead>Last signed in</DenseHead>
                      <DenseHead className="text-right align-bottom">
                        Access
                      </DenseHead>
                    </DenseRow>
                  </DenseHeader>
                  <DenseBody>
                    {rows.map(user => {
                      const isSelf = user.id === currentUserId;
                      return (
                        <DenseRow
                          key={user.id}
                          className={
                            user.isActive ? undefined : "bg-slate-50/60"
                          }
                        >
                          <DenseCell>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-semibold text-slate-800">
                                {user.name || "—"}
                              </span>
                              {isSelf ? (
                                <Badge className="border-slate-200 bg-slate-100 text-slate-600">
                                  You
                                </Badge>
                              ) : null}
                              {/* Deactivated accounts keep their row but read as
                                closed, so the state is on the name rather than
                                only in the button that would undo it. */}
                              {user.isActive ? null : (
                                <Badge className="border-slate-300 bg-slate-100 text-slate-500">
                                  Deactivated
                                </Badge>
                              )}
                            </div>
                          </DenseCell>
                          <DenseCell>
                            {/* Editable in place. A username can only be set at
                                creation otherwise, so an account whose name
                                changed — or one that has to be renamed because
                                the sign-in name collided — could not be fixed
                                at all, and Settings told the officer to ask the
                                administrator for something the administrator
                                had no control for. */}
                            {naming === user.id ? (
                              <div className="space-y-1.5">
                                <Input
                                  id={`username-${user.id}`}
                                  name="username"
                                  value={usernameDraft}
                                  onChange={e => setUsernameDraft(e.target.value)}
                                  className="h-8 font-mono text-[12px]"
                                  autoFocus
                                />
                                <div className="flex gap-1.5">
                                  <Button
                                    size="sm"
                                    disabled={
                                      usernameDraft.trim().length < 3 ||
                                      setUsernameMutation.isPending
                                    }
                                    onClick={() =>
                                      setUsernameMutation.mutate(
                                        {
                                          id: user.id,
                                          username: usernameDraft.trim(),
                                        },
                                        { onSuccess: () => setNaming(null) }
                                      )
                                    }
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setNaming(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : user.username ? (
                              <button
                                type="button"
                                className="group inline-flex items-center gap-1.5 text-left"
                                onClick={() => {
                                  setNaming(user.id);
                                  setUsernameDraft(user.username ?? "");
                                }}
                              >
                                <span className="font-mono text-[12px] text-slate-700 group-hover:underline">
                                  {user.username}
                                </span>
                                <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="text-left text-[11px] text-slate-400 hover:text-slate-600"
                                onClick={() => {
                                  setNaming(user.id);
                                  setUsernameDraft("");
                                }}
                              >
                                {user.hasPassword
                                  ? "derived from email — set one"
                                  : "identity provider — set one"}
                              </button>
                            )}
                          </DenseCell>
                          <DenseCell className="text-slate-600">
                            {user.email || "—"}
                          </DenseCell>
                          <DenseCell>
                            <Select
                              value={user.role}
                              disabled={isSelf || setRoleMutation.isPending}
                              onValueChange={v =>
                                setRoleMutation.mutate(
                                  { id: user.id, role: v as Role },
                                  {
                                    onSuccess: () =>
                                      toast.success(
                                        `${user.name} is now ${ROLE_LABELS[v as Role]}`
                                      ),
                                  }
                                )
                              }
                            >
                              <SelectTrigger
                                className={`h-9 w-full ${roleBadge[user.role]}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_VALUES.map(value => (
                                  <SelectItem key={value} value={value}>
                                    {ROLE_LABELS[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </DenseCell>
                          <DenseCell className="whitespace-nowrap text-slate-500 tabular-nums">
                            {formatDateTime(user.lastSignedIn)}
                            {/* How much of the register this person is
                                answerable for, and therefore whether the
                                account can be deleted at all rather than only
                                deactivated. It sits under the sign-in
                                because that is the record they leave, not
                                under the username it has nothing to do with. */}
                            {user.references.total > 0 ? (
                              <p className="mt-0.5 text-[10px] leading-4 text-slate-400 tabular-nums">
                                {user.references.total} record
                                {user.references.total === 1 ? "" : "s"} in the
                                trail
                              </p>
                            ) : null}
                          </DenseCell>
                          <DenseCell className="text-right align-top">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setResetFor(
                                    resetFor === user.id ? null : user.id
                                  );
                                  setResetValue("");
                                }}
                              >
                                {user.hasPassword
                                  ? "Reset password"
                                  : "Set password"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isSelf}
                                title={
                                  isSelf
                                    ? "You cannot delete your own account"
                                    : user.references.total > 0
                                      ? "This person is in the accountability trail — deactivate them instead"
                                      : "Delete this account"
                                }
                                className={cn(
                                  "border-rose-300 text-rose-700 hover:bg-rose-50",
                                  user.references.total > 0 &&
                                    !isSelf &&
                                    "cursor-not-allowed opacity-50"
                                )}
                                onClick={() => {
                                  if (isSelf) return;
                                  if (user.references.total > 0) {
                                    toast.error(
                                      `${user.name ?? "This person"} appears in the accountability trail. Deactivate the account instead — it closes the sign-in and keeps the record.`,
                                      { duration: 9000 }
                                    );
                                    return;
                                  }
                                  setDeleting(
                                    deleting === user.id ? null : user.id
                                  );
                                }}
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={setActiveMutation.isPending}
                                onClick={() =>
                                  setActiveMutation.mutate(
                                    { id: user.id, isActive: !user.isActive },
                                    {
                                      onSuccess: () =>
                                        toast.success(
                                          `${user.name} ${user.isActive ? "deactivated" : "reactivated"}`
                                        ),
                                    }
                                  )
                                }
                              >
                                {user.isActive ? "Deactivate" : "Reactivate"}
                              </Button>
                            </div>
                          </DenseCell>
                        </DenseRow>
                      );
                    })}
                    {deleting !== null ? (
                      <DenseRow className="bg-rose-50">
                        <DenseCell colSpan={6}>
                          <div className="flex flex-wrap items-center gap-3">
                            <TriangleAlert className="h-4 w-4 shrink-0 text-rose-700" />
                            <p className="text-[12px] leading-5 text-rose-900">
                              Delete{" "}
                              <strong>
                                {rows.find(u => u.id === deleting)?.name ??
                                  "this account"}
                              </strong>{" "}
                              permanently? This cannot be undone, and only works
                              because they have no history in the register.
                            </p>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={deleteMutation.isPending}
                              onClick={() =>
                                deleteMutation.mutate({ id: deleting })
                              }
                            >
                              {deleteMutation.isPending
                                ? "Deleting…"
                                : "Yes, delete this account"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleting(null)}
                            >
                              Keep it
                            </Button>
                          </div>
                        </DenseCell>
                      </DenseRow>
                    ) : null}
                    {resetFor !== null ? (
                      <DenseRow className="bg-slate-50">
                        <DenseCell colSpan={6}>
                          <form
                            className="flex flex-wrap items-end gap-3"
                            onSubmit={event => {
                              event.preventDefault();
                              setPasswordMutation.mutate({
                                id: resetFor,
                                password: resetValue,
                              });
                            }}
                          >
                            <div className="min-w-[200px] flex-1">
                              <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                                New password
                              </label>
                              <Input
                                id="reset-password"
                                name="password"
                                required
                                type="password"
                                minLength={10}
                                autoFocus
                                value={resetValue}
                                onChange={e => setResetValue(e.target.value)}
                                placeholder="At least 10 characters"
                                className="mt-1 h-9"
                              />
                            </div>
                            <Button
                              type="submit"
                              disabled={setPasswordMutation.isPending}
                              className="h-9"
                            >
                              {setPasswordMutation.isPending
                                ? "Saving…"
                                : "Save password"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-9"
                              onClick={() => {
                                setResetFor(null);
                                setResetValue("");
                              }}
                            >
                              Cancel
                            </Button>
                          </form>
                        </DenseCell>
                      </DenseRow>
                    ) : null}
                  </DenseBody>
                </DenseTable>
              </div>
            </>
          )}
        </div>
      </CardPanel>

      <CardPanel
        title="What each role can do"
        description="Higher tiers inherit every capability below them."
      >
        <DenseTable>
          <DenseHeader>
            <tr>
              <DenseHead>Role</DenseHead>
              <DenseHead>Capabilities</DenseHead>
            </tr>
          </DenseHeader>
          <DenseBody>
            {[...ROLE_VALUES]
              .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])
              .map(value => (
                <DenseRow key={value}>
                  <DenseCell className="w-52">
                    <Badge className={roleBadge[value]}>
                      {ROLE_LABELS[value]}
                    </Badge>
                  </DenseCell>
                  <DenseCell className="whitespace-normal text-slate-600">
                    {ROLE_DESCRIPTIONS[value]}
                  </DenseCell>
                </DenseRow>
              ))}
          </DenseBody>
        </DenseTable>
      </CardPanel>
    </div>
  );
}

// ---------------------------------------------------------------- Audit

function AuditTab() {
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState<string>("all");
  const [page, setPage] = useState(1);

  const types = trpc.admin.audit.eventTypes.useQuery();
  // Paged, and the filters run server-side. The search and the type filter used
  // to be applied to the newest 200 rows after the query had already taken them,
  // so anything older was unsearchable and the screen said "no entries match"
  // about an entry that was sitting in the database. An audit trail that answers
  // wrongly is worse than one that admits it is a page of a longer history.
  const audit = trpc.admin.audit.list.useQuery(
    {
      search: search || undefined,
      eventType: eventType === "all" ? undefined : eventType,
      limit: AUDIT_PAGE_SIZE,
      offset: offsetFor(page, AUDIT_PAGE_SIZE),
    },
    { placeholderData: keepPreviousData }
  );

  const rows = audit.data?.rows ?? [];
  const total = audit.data?.total ?? 0;
  const auditPages = pageCount(total, AUDIT_PAGE_SIZE);
  const currentPage = clampPage(page, total, AUDIT_PAGE_SIZE);

  // A narrowed filter or a deleted entry can leave the officer past the end.
  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page, search, eventType]);

  useEffect(() => {
    setPage(1);
  }, [search, eventType]);

  return (
    <CardPanel
      title="Global audit trail"
      description={`Every recorded action across the register, newest first. ${
        total ? `${total} ${total === 1 ? "entry" : "entries"} match.` : ""
      }`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="audit-search"
            name="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes, refs, teachers, actors"
            className="h-8 w-64 text-[13px]"
          />
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-8 w-48 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {(types.data ?? []).map(value => (
                <SelectItem key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {audit.isLoading ? (
        <div className="space-y-2 py-2">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-9 rounded" />
          ))}
        </div>
      ) : rows.length ? (
        <>
          {/* Fixed layout with stated widths, and a floor on the table. The
              Detail column holds a free-text note of unbounded length, so it
              needs a stated share to wrap into; under the automatic layout the
              `max-w-0` floor already in force on the cells leaves that share
              entirely to the content, and one long note widens the table. */}
          <div className="overflow-x-auto">
            <DenseTable fixed className="min-w-[880px]">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[18%]" />
                <col className="w-[13%]" />
                <col className="w-[38%]" />
                <col className="w-[16%]" />
              </colgroup>
              <DenseHeader>
                <DenseRow>
                  <DenseHead>When</DenseHead>
                  <DenseHead>Matter</DenseHead>
                  <DenseHead>Event</DenseHead>
                  <DenseHead>Detail</DenseHead>
                  <DenseHead>Actor</DenseHead>
                </DenseRow>
              </DenseHeader>
              <DenseBody>
                {rows.map(row => (
                  <DenseRow key={row.id}>
                    <DenseCell className="whitespace-nowrap text-slate-500">
                      {formatDateTime(row.createdAt)}
                    </DenseCell>
                    <DenseCell>
                      <Link
                        href={`/cases/${row.caseId}`}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {row.caseNumber}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.teacherName}
                      </p>
                    </DenseCell>
                    <DenseCell>
                      <Badge className="border-slate-300 bg-slate-100 text-slate-600">
                        {row.eventType.replace(/_/g, " ")}
                      </Badge>
                    </DenseCell>
                    <DenseCell className="text-slate-700">{row.note}</DenseCell>
                    <DenseCell className="text-slate-600">
                      {row.actorName || "System"}
                    </DenseCell>
                  </DenseRow>
                ))}
              </DenseBody>
            </DenseTable>
          </div>

          {auditPages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                Page {currentPage} of {auditPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= auditPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="py-10 text-center text-[13px] text-slate-500">
          No audit entries match the current filters.
        </p>
      )}
    </CardPanel>
  );
}

// ---------------------------------------------------------------- Oversight

function OversightTab() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState("");
  const [page, setPage] = useState(1);

  // Two different lists, and conflating them emptied the table: the dropdown
  // labelled "All provinces" was populated from the officer list and sent as the
  // `province` filter, so every officer name matched nothing and "All provinces"
  // — the value "all" — was truthy, filtering on the literal string "all".
  // Provinces come from the provinces procedure; officers are only for the
  // reassignment picker.
  const provinces = trpc.admin.provinces.useQuery();
  const officers = trpc.admin.officers.useQuery();
  const cases = trpc.admin.cases.list.useQuery(
    {
      search: search || undefined,
      province: province || undefined,
      limit: OVERSIGHT_PAGE_SIZE,
      offset: offsetFor(page, OVERSIGHT_PAGE_SIZE),
    },
    // Hold the page on screen while the next is fetched, so overriding a status
    // on page 2 does not blank the table they are reading.
    { placeholderData: keepPreviousData }
  );
  // Both of these change the matter itself, not just the oversight view, so they
  // dirty the same reads a change made from the matter file does. Overriding a
  // status here previously left the register and the dashboard showing the old
  // one — the officer's next page load disagreed with what they had just done.
  const reassign = trpc.admin.cases.reassign.useMutation({
    onSuccess: updated => {
      void invalidateMatterWrites(utils, updated?.id);
      toast.success("Officer reassigned and logged");
    },
    onError: e => toast.error(e.message),
  });
  const setStatus = trpc.admin.cases.setStatus.useMutation({
    onSuccess: updated => {
      void invalidateMatterWrites(utils, updated?.id);
      toast.success("Status overridden and logged");
    },
    onError: e => toast.error(e.message),
  });

  const rows = cases.data?.rows ?? [];
  const total = cases.data?.total ?? 0;
  const oversightPages = pageCount(total, OVERSIGHT_PAGE_SIZE);
  const currentPage = clampPage(page, total, OVERSIGHT_PAGE_SIZE);
  // The statuses an override may move a matter *to*. Closing statuses are
  // excluded: the Golden Rule refuses to close a matter without a recorded
  // outcome, a date closed and a record of who communicated it, and the
  // override select has no way to collect those three — so offering RES and CLS
  // here only ever produced a refusal. Reopening a matter that was closed in
  // error still works, because the row's own current status is always in the
  // list and the statuses it can move to are all open.
  const openStatuses = STATUS_VALUES.filter(isOpenStatus);

  /**
   * Filtering sends the administrator back to the first page, and an override
   * made on the last page can remove the row that page was holding. Both are the
   * same correction: a page held in state that the register no longer has.
   */
  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page, search, province]);

  useEffect(() => {
    setPage(1);
  }, [search, province]);

  return (
    <CardPanel
      title="Matter oversight"
      description="Every matter regardless of assigned officer. Overrides are written to the audit trail."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="oversight-search"
            name="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Case reference or teacher"
            className="h-8 w-52 text-[13px]"
          />
          <Select value={province} onValueChange={setProvince}>
            <SelectTrigger className="h-8 w-52 text-[13px]">
              <SelectValue placeholder="All provinces" />
            </SelectTrigger>
            <SelectContent>
              {(provinces.data ?? []).map(value => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {cases.isLoading ? (
        <div className="space-y-2 py-2">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-9 rounded" />
          ))}
        </div>
      ) : (
        <>
          {/* Fixed layout: the Oversight column holds two selects, which
              cannot shrink, so the column widths are stated rather than
              negotiated against the content. */}
          <DenseTable fixed>
            <colgroup>
              <col className="w-[19%]" />
              <col className="w-[17%]" />
              <col className="w-[13%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[21%]" />
            </colgroup>
            <DenseHeader>
              <DenseRow>
                <DenseHead>Case reference</DenseHead>
                <DenseHead>Teacher</DenseHead>
                <DenseHead>Status</DenseHead>
                <DenseHead>Due</DenseHead>
                <DenseHead>Officer</DenseHead>
                <DenseHead className="text-right align-bottom">
                  Oversight
                </DenseHead>
              </DenseRow>
            </DenseHeader>
            <DenseBody>
              {rows.map(item => (
                <DenseRow key={item.id}>
                  <DenseCell>
                    <Link
                      href={`/cases/${item.id}`}
                      className="font-mono text-xs font-semibold text-primary hover:underline"
                    >
                      {item.caseNumber}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.matterType} · {item.province}
                    </p>
                  </DenseCell>
                  <DenseCell className="font-medium text-slate-800">
                    {item.teacherName}
                  </DenseCell>
                  <DenseCell>
                    <Badge
                      className={`border ${STATUS_CLASSES[item.status as CaseStatus]}`}
                    >
                      {STATUS_SHORT[item.status as CaseStatus] ?? item.status}
                    </Badge>
                  </DenseCell>
                  <DenseCell>
                    <span
                      className={
                        isOverdue(item.status, item.dueDate)
                          ? "font-semibold text-rose-700"
                          : "text-slate-600"
                      }
                    >
                      {formatDate(item.dueDate)}
                    </span>
                  </DenseCell>
                  <DenseCell className="text-slate-600">
                    {item.assignedOfficerName || "Unassigned"}
                  </DenseCell>
                  <DenseCell className="align-top">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Select
                        disabled={reassign.isPending}
                        onValueChange={value =>
                          reassign.mutate({
                            id: item.id,
                            assignedOfficerName: value,
                          })
                        }
                      >
                        <SelectTrigger className="h-9 w-40">
                          <SelectValue placeholder="Reassign" />
                        </SelectTrigger>
                        <SelectContent>
                          {(officers.data ?? []).map(value => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={item.status}
                        disabled={setStatus.isPending}
                        onValueChange={value => {
                          const next = value as CaseStatus;
                          if (next === item.status) return;
                          const reason = window.prompt(
                            `Override ${item.caseNumber} to "${STATUS_SHORT[next]}".\n\nReason (recorded in the audit trail):`
                          );
                          if (!reason || reason.trim().length < 3) return;
                          setStatus.mutate({
                            id: item.id,
                            status: next,
                            note: reason.trim(),
                          });
                        }}
                      >
                        <SelectTrigger className="h-9 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* The row's own status is always present, so a matter
                              that is already resolved or closed shows its status
                              here rather than an empty control — and the
                              override can still reopen it. */}
                          {[item.status, ...openStatuses]
                            .filter(
                              (value, index, all) =>
                                all.indexOf(value) === index
                            )
                            .map(value => (
                              <SelectItem key={value} value={value}>
                                {STATUS_SHORT[value as CaseStatus] ?? value}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </DenseCell>
                </DenseRow>
              ))}
            </DenseBody>
          </DenseTable>
        </>
      )}

      {/* Only when there is somewhere to go, for the same reason as the
          register's: on a single page it would be telling the administrator
          something they can already see. */}
      {rows.length > 0 && oversightPages > 1 ? (
        <Pagination className="mt-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={currentPage <= 1}
                className={
                  currentPage <= 1 ? "pointer-events-none opacity-50" : undefined
                }
                onClick={event => {
                  event.preventDefault();
                  setPage(clampPage(currentPage - 1, total, OVERSIGHT_PAGE_SIZE));
                }}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 py-2 text-xs text-slate-600">
                Page {currentPage} of {oversightPages} · {total} matter
                {total === 1 ? "" : "s"}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={currentPage >= oversightPages}
                className={
                  currentPage >= oversightPages
                    ? "pointer-events-none opacity-50"
                    : undefined
                }
                onClick={event => {
                  event.preventDefault();
                  setPage(clampPage(currentPage + 1, total, OVERSIGHT_PAGE_SIZE));
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </CardPanel>
  );
}

// ---------------------------------------------------------------- Stats

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; count: number }[];
  total: number;
}) {
  return (
    <CardPanel title={title}>
      <DenseTable>
        <DenseHeader>
          <tr>
            <DenseHead>
              {title.replace(/^Matters by |^Accounts by /, "")}
            </DenseHead>
            <NumHead>Count</NumHead>
            <NumHead>Share</NumHead>
          </tr>
        </DenseHeader>
        <DenseBody>
          {rows.length ? (
            rows.map(row => {
              const share = total ? Math.round((row.count / total) * 100) : 0;
              return (
                <DenseRow key={row.label}>
                  <DenseCell className="text-slate-700">{row.label}</DenseCell>
                  <NumCell className="font-semibold">{row.count}</NumCell>
                  <NumCell className="text-slate-500">{share}%</NumCell>
                </DenseRow>
              );
            })
          ) : (
            <EmptyRow colSpan={3}>Nothing recorded yet.</EmptyRow>
          )}
        </DenseBody>
      </DenseTable>
    </CardPanel>
  );
}

function StatsTab() {
  const stats = trpc.admin.stats.useQuery();

  if (stats.isLoading) {
    return <Skeleton className="mx-auto h-64 max-w-[1400px] rounded-lg" />;
  }
  if (stats.isError) {
    return (
      <div className="flex items-center gap-3 border-y border-rose-200 bg-rose-50/50 px-4 py-3 text-[13px] text-rose-800">
        <AlertTriangle className="h-4 w-4" /> {stats.error.message}
      </div>
    );
  }

  const data = stats.data;
  if (!data) return null;
  const peak = Math.max(
    1,
    ...data.monthly.map(m => Math.max(m.received, m.closed))
  );

  return (
    <div className="space-y-6">
      <StatTable
        items={[
          {
            label: "Matters",
            value: data.totals.matters,
            detail: `${data.totals.active} still open`,
          },
          {
            label: "Overdue",
            value: data.totals.overdue,
            detail: `${data.totals.overdueRate}% of open matters`,
            tone: "text-rose-700",
          },
          {
            label: "Accounts",
            value: data.totals.users,
            detail: `${data.totals.activeUsers} active`,
          },
          {
            label: "Audit events",
            value: data.totals.auditEvents,
            detail: "Most recent 500 shown",
          },
        ]}
      />

      <CardPanel
        title="Twelve-month throughput"
        description="Matters received against matters closed."
        bodyClassName="border-y border-slate-300 px-0 py-4"
      >
        {/* Columns must stretch to the fixed height or the percentage-height
            bars have no definite parent height and collapse to zero. The
            `items-end` belongs on the inner row, to bottom-align the bars. */}
        <div className="flex h-48 items-stretch gap-2 px-2">
          {data.monthly.map(month => (
            <div
              key={month.month}
              className="flex flex-1 flex-col items-center gap-2"
            >
              <div className="flex w-full flex-1 items-end justify-center gap-1">
                <div
                  className="w-1/2 rounded-t bg-primary"
                  style={{ height: `${(month.received / peak) * 100}%` }}
                  title={`${month.received} received`}
                />
                <div
                  className="w-1/2 rounded-t bg-slate-300"
                  style={{ height: `${(month.closed / peak) * 100}%` }}
                  title={`${month.closed} closed`}
                />
              </div>
              <span className="text-[10px] text-slate-400">
                {monthLabel(month.month)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-5 px-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" /> Received
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-300" /> Closed
          </span>
        </div>
      </CardPanel>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Breakdown
          title="Matters by province"
          total={data.totals.matters}
          rows={data.byProvince.map(r => ({
            label: r.province,
            count: r.count,
          }))}
        />
        <Breakdown
          title="Matters by status"
          total={data.totals.matters}
          rows={data.byStatus.map(r => ({
            label: statusLabel(r.status),
            count: r.count,
          }))}
        />
        <Breakdown
          title="Matters by type"
          total={data.totals.matters}
          rows={data.byMatterType.map(r => ({
            label: r.matterType,
            count: r.count,
          }))}
        />
        <Breakdown
          title="Accounts by role"
          total={data.totals.users}
          rows={data.byRole.map(r => ({
            label: roleLabel(r.role),
            count: r.count,
          }))}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Page

export default function Admin() {
  const { data: user, isLoading: loading } = trpc.auth.me.useQuery();

  if (loading)
    return (
      <DashboardLayout>
        <Skeleton className="mx-auto h-64 max-w-[1400px] rounded-xl" />
      </DashboardLayout>
    );

  // Gate on the platform capabilities rather than on the super-administrator
  // role. The four tabs below are gated individually on the same capabilities the
  // server enforces, so the Administrator tier - which holds platform:oversight
  // and nothing else here - reaches the one tab it is entitled to instead of
  // being refused the whole screen on the way to it.
  const tabs = ADMIN_TABS.filter(tab => can(user?.role, tab.capability));
  const canOpenAdmin = tabs.length > 0;

  if (!user || !canOpenAdmin) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl pt-16">
          <div className="border-y border-rose-200 bg-rose-50/40 px-6 py-10 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-rose-600" />
            <h1 className="mt-4 text-xl font-semibold text-rose-950">
              Administration access required
            </h1>
            <p className="mt-2 text-sm leading-6 text-rose-800">
              Administration is restricted to officers holding a platform
              capability. Your account is signed in as{" "}
              {user?.role ? ROLE_LABELS[user.role] : "unknown"}.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageShell>
        <PageHeader
          eyebrow="Platform oversight"
          title="Super administration"
          description="Manage who has access, review everything that has happened across the register, oversee any matter, and read system-wide statistics."
        />

        <Tabs defaultValue={tabs[0]!.value}>
          <TabStrip>
            {tabs.map(tab => (
              <TabStripItem key={tab.value} value={tab.value}>
                <tab.icon className="mr-2 h-3.5 w-3.5" /> {tab.label}
              </TabStripItem>
            ))}
          </TabStrip>

          <TabsContent value="users" className="mt-5">
            <UsersTab currentUserId={user!.id} />
          </TabsContent>
          <TabsContent value="oversight" className="mt-5">
            <OversightTab />
          </TabsContent>
          <TabsContent value="audit" className="mt-5">
            <AuditTab />
          </TabsContent>
          <TabsContent value="stats" className="mt-5">
            <StatsTab />
          </TabsContent>
        </Tabs>
      </PageShell>
    </DashboardLayout>
  );
}
