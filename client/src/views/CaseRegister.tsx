"use client";

import DashboardLayout from "@/components/DashboardLayout";
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
import { PageHeader, PageShell } from "@/components/PageHeader";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SkeletonRows,
} from "@/components/States";
import { StatusTag } from "@/components/StatusIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { can } from "@shared/access";
import {
  matterTypeValues,
  provinceValues,
  type MatterType,
} from "@shared/matters";
import {
  REGISTER_PAGE_SIZE,
  clampPage,
  offsetFor,
  pageCount,
} from "@shared/pagination";
import {
  CLOSED_STATUSES,
  STATUS_LABELS,
  STATUS_VALUES,
  isOverdue,
  type CaseStatus,
} from "@shared/statuses";
import {
  AlertTriangle,
  FilePlus2,
  Filter,
  ListFilter,
  Search,
  Stamp,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * The central case register.
 *
 * The manual describes the register as the single record of every matter in the
 * province, so this screen shows everything and filters rather than presenting a
 * personal queue. The default view is deliberately unfiltered: an officer
 * arriving here to check whether a matter they have heard about exists should
 * not have to guess which filter hides it.
 *
 * The search is debounced and the query key is the whole filter object, so React
 * Query keeps a cache entry per combination. Going back from a matter to a
 * filtered register therefore restores the filter that produced the list.
 */

const DEBOUNCE_MS = 250;

export default function CaseRegister() {
  const { data: user } = trpc.auth.me.useQuery();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [matterType, setMatterType] = useState("");
  const [province, setProvince] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Omitted rather than sent empty: the server's filters are all `.optional()`,
  // and an empty string would be a value it would have to exclude.
  const filters = useMemo(
    () => ({
      ...(debounced.trim() ? { search: debounced.trim() } : {}),
      ...(status ? { status: status as CaseStatus } : {}),
      ...(matterType ? { matterType: matterType as MatterType } : {}),
      ...(province ? { province } : {}),
      ...(overdueOnly ? { overdueOnly: true } : {}),
    }),
    [debounced, status, matterType, province, overdueOnly]
  );

  /**
   * Narrowing the filters sends the officer back to the first page, because a
   * register that kept them on page 3 of 12 would show them an empty table. It
   * is done here rather than in each control's handler so that the search box and
   * the four filter selects cannot behave differently from one another.
   */
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const utils = trpc.useUtils();

  const query = trpc.caseManagement.list.useQuery(
    {
      ...filters,
      limit: REGISTER_PAGE_SIZE,
      offset: offsetFor(page, REGISTER_PAGE_SIZE),
    },
    // Hold the page already on screen while the next one is fetched, so turning
    // a page does not collapse the table into a skeleton and throw away the rows
    // the officer was reading.
    { placeholderData: keepPreviousData }
  );

  const total = query.data?.total ?? 0;
  const pages = pageCount(total, REGISTER_PAGE_SIZE);
  const currentPage = clampPage(page, total, REGISTER_PAGE_SIZE);

  /**
   * Corrects a page that has fallen outside the register.
   *
   * The reset above handles the common case, where the officer narrows the
   * filters themselves. This handles the one that is not theirs: a matter
   * written from another screen can remove the last row of the last page while
   * they are sitting on it, and without this they would be left looking at an
   * empty table on page 3 of 2.
   *
   * It is a separate effect rather than a clamp in the query input because
   * `total` is only known once the rows have arrived, so the input cannot
   * depend on it without the query depending on its own result.
   */
  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page]);

  const clearAll = () => {
    setSearch("");
    setDebounced("");
    setStatus("");
    setMatterType("");
    setProvince("");
    setOverdueOnly(false);
  };

  const activeFilterCount =
    (status ? 1 : 0) +
    (matterType ? 1 : 0) +
    (province ? 1 : 0) +
    (overdueOnly ? 1 : 0);

  const rows = query.data?.rows ?? [];

  /**
   * The figures across the whole register, not the filtered page. They answer
   * "how is the province doing", which a count of the current filter would not:
   * a register showing zero overdue matters while the filter hides an overdue
   * province is misleading, and the filter chips already show what is applied.
   *
   * Counted by the server. They used to be counted here, in the browser, by
   * reading a second copy of the entire register — which is the reason the
   * register is paged at all. They are also, now, the only place the Golden Rule
   * breach count comes from; the register surfaces it rather than leaving it to
   * the compliance report.
   */
  const summary = trpc.caseManagement.summary.useQuery();
  const figures = summary.data;

  const canRegister = can(user?.role, "matter:register");

  return (
    <DashboardLayout>
      <PageShell>
        <PageHeader
          eyebrow="The central record"
          title="Case register"
          description="Every matter received in the province, as the manual requires it to be kept."
          icon={ListFilter}
          action={
            canRegister ? (
              <Button asChild size="sm">
                <Link href="/cases/new">
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  Register matter
                </Link>
              </Button>
            ) : null
          }
        />

        <StatTable
          items={[
            {
              label: "Matters on the register",
              value: figures?.total ?? 0,
              detail: `${figures?.open ?? 0} still open`,
            },
            {
              label: "Past their due date",
              value: figures?.overdue ?? 0,
              detail: "A matter should not be held indefinitely",
              tone: figures?.overdue ? "text-red-700" : undefined,
            },
            {
              label: "Without an assigned action",
              value: figures?.withoutAction ?? 0,
              detail: "The Golden Rule",
              tone: figures?.withoutAction ? "text-red-700" : undefined,
            },
            {
              label: "Unassigned",
              value: figures?.unassigned ?? 0,
              detail: "No officer holds these matters",
              tone: figures?.unassigned ? "text-amber-700" : undefined,
            },
          ]}
        />

        <CardPanel
          title="Find a matter"
          description="Search by case number or the teacher's name, or narrow by status, type or province."
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id="register-search"
                name="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Case number or teacher's name"
                className="pl-8"
                aria-label="Search the register"
              />
            </div>
            <Button
              variant={
                showFilters || activeFilterCount ? "secondary" : "outline"
              }
              onClick={() => setShowFilters(value => !value)}
              aria-expanded={showFilters}
            >
              <Filter className="mr-2 h-4 w-4" />
              Filters
              {activeFilterCount ? (
                <span className="ml-1.5 rounded bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
            {activeFilterCount || search ? (
              <Button variant="ghost" onClick={clearAll}>
                <X className="mr-2 h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </div>

          {showFilters ? (
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <FilterSelect
                id="filter-status"
                label="Status"
                value={status}
                onChange={setStatus}
                options={STATUS_VALUES.map(value => ({
                  value,
                  label: STATUS_LABELS[value],
                }))}
                anyLabel="Any status"
              />
              <FilterSelect
                id="filter-matter-type"
                label="Matter type"
                value={matterType}
                onChange={setMatterType}
                options={matterTypeValues.map(value => ({
                  value,
                  label: value,
                }))}
                anyLabel="Any type"
              />
              <FilterSelect
                id="filter-province"
                label="Province"
                value={province}
                onChange={setProvince}
                options={provinceValues.map(value => ({
                  value,
                  label: value,
                }))}
                anyLabel="Any province"
              />
              <label className="flex items-end gap-2 pb-1.5">
                <input
                  id="filter-overdue"
                  name="overdueOnly"
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={event => setOverdueOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-sm text-slate-700">
                  Past due date only
                </span>
              </label>
            </div>
          ) : null}
        </CardPanel>

        <CardPanel
          title="Register"
          description={
            query.isLoading
              ? "Loading…"
              : `${rows.length} matter${rows.length === 1 ? "" : "s"}${
                  activeFilterCount || debounced
                    ? " matching"
                    : " on the register"
                }.`
          }
        >
          {query.isLoading ? (
            <LoadingState label="The register">
              <SkeletonRows rows={6} />
            </LoadingState>
          ) : query.error ? (
            <ErrorState
              title="The register could not be loaded"
              message={query.error.message}
              onRetry={() => void utils.caseManagement.list.invalidate()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              text={
                activeFilterCount || debounced
                  ? "No matter matches these filters."
                  : "No matters have been registered yet."
              }
            >
              {canRegister && !activeFilterCount && !debounced ? (
                <Button asChild variant="secondary">
                  <Link href="/cases/new">
                    <Stamp className="mr-2 h-4 w-4" />
                    Register the first matter
                  </Link>
                </Button>
              ) : null}
            </EmptyState>
          ) : (
            <DenseTable fixed className="min-w-[1080px]">
              <DenseHeader>
                <DenseRow>
                  <DenseHead>Case</DenseHead>
                  <DenseHead>Teacher</DenseHead>
                  <DenseHead>Province</DenseHead>
                  <DenseHead>Type</DenseHead>
                  <DenseHead>Status</DenseHead>
                  <DenseHead>Officer</DenseHead>
                  <DenseHead>Action</DenseHead>
                  <NumHead>Received</NumHead>
                  <NumHead>Due</NumHead>
                </DenseRow>
              </DenseHeader>
              <DenseBody>
                {rows.map(item => {
                  const late = isOverdue(item.status, item.dueDate);
                  const missingAction =
                    !isClosed(item.status) && !item.actionRequired?.trim();
                  return (
                    <DenseRow key={item.id}>
                      <DenseCell>
                        <Link
                          href={`/cases/${item.id}`}
                          className="font-mono text-xs font-medium text-teal-800 hover:underline"
                        >
                          {item.caseNumber}
                        </Link>
                        {item.priority === "urgent" ? (
                          <span className="ml-1.5 rounded bg-red-50 px-1 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                            Urgent
                          </span>
                        ) : null}
                      </DenseCell>
                      <DenseCell>
                        <Link
                          href={`/cases/${item.id}`}
                          className="hover:underline"
                        >
                          {item.teacherName}
                        </Link>
                        {item.employeeReference ? (
                          <span className="ml-1.5 text-xs text-slate-500">
                            {item.employeeReference}
                          </span>
                        ) : null}
                      </DenseCell>
                      <DenseCell className="text-slate-600">
                        {item.province}
                      </DenseCell>
                      <DenseCell className="text-slate-600">
                        {item.matterType}
                      </DenseCell>
                      <DenseCell>
                        <StatusTag status={item.status} />
                        {item.decisionRequired ? (
                          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                            Director
                          </span>
                        ) : null}
                      </DenseCell>
                      <DenseCell className="text-slate-600">
                        {item.assignedOfficerName ?? (
                          <span className="text-amber-700">Unassigned</span>
                        )}
                      </DenseCell>
                      <DenseCell className="max-w-[220px]">
                        {missingAction ? (
                          <span className="text-xs text-red-700">
                            No action recorded
                          </span>
                        ) : (
                          <span className="line-clamp-2 text-xs text-slate-600">
                            {item.actionRequired ?? "—"}
                          </span>
                        )}
                      </DenseCell>
                      <NumCell className="whitespace-nowrap text-slate-600">
                        {formatDate(item.dateReceived)}
                      </NumCell>
                      <NumCell
                        className={
                          late
                            ? "whitespace-nowrap font-medium text-red-700"
                            : "whitespace-nowrap text-slate-600"
                        }
                      >
                        {item.dueDate ? (
                          <>
                            {late ? (
                              <AlertTriangle
                                className="mr-1 inline h-3 w-3"
                                aria-hidden
                              />
                            ) : null}
                            {formatDate(item.dueDate)}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </NumCell>
                    </DenseRow>
                  );
                })}
              </DenseBody>
            </DenseTable>
          )}

          {/**
           * The pager sits outside the table and outside the scroll container,
           * so it stays put while the rows scroll inside it. It is rendered
           * whenever there is a second page to reach — on a single-page register
           * it would only be telling the officer something they can see.
           */}
          {rows.length > 0 && pages > 1 ? (
            <Pagination className="mt-4">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={currentPage <= 1}
                    className={
                      currentPage <= 1
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                    onClick={event => {
                      event.preventDefault();
                      setPage(current =>
                        clampPage(current - 1, total, REGISTER_PAGE_SIZE)
                      );
                    }}
                  />
                </PaginationItem>

                <PaginationItem>
                  <span className="px-3 py-2 text-xs text-slate-600">
                    Page {currentPage} of {pages} · {total} matter
                    {total === 1 ? "" : "s"}
                  </span>
                </PaginationItem>

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={currentPage >= pages}
                    className={
                      currentPage >= pages
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                    onClick={event => {
                      event.preventDefault();
                      setPage(current =>
                        clampPage(current + 1, total, REGISTER_PAGE_SIZE)
                      );
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </CardPanel>
      </PageShell>
    </DashboardLayout>
  );
}

function isClosed(status: string) {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

/**
 * A labelled `<select>`. Pulled out because the filter panel has four of them
 * and the shared list is long enough that restating the wrapper four times is
 * how the "Any…" option ends up reading "Any province" in one row and "All
 * provinces" in the next.
 */
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  /** Also the field name, so each filter is addressable and autofillable. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        id={id}
        name={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
      >
        <option value="">{anyLabel}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
