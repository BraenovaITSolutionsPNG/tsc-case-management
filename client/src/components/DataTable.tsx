import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * The dense table primitives the register and admin screens are built from.
 *
 * A register has more columns than fit on a laptop and officers will have their
 * own column preferences, so the tables scroll horizontally rather than
 * dropping columns. `DenseTable fixed` pins the header while the body scrolls,
 * which is what makes a 40-row register readable without losing the column
 * names partway down.
 *
 * These are thin wrappers over plain table elements rather than a component with
 * a column spec, because several of the tables on these screens are ragged -
 * the audit trail and the oversight list do not share a shape, and a schema-less
 * wrapper would only move the markup out of sight.
 */

// A rounded, titled panel. The admin screen uses it for every section, so the
// padding and border are fixed here rather than repeated a dozen times.
export function CardPanel({
  title,
  description,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  description?: string;
  /**
   * A mark shown to the left of the title, for panels that are identifiable at a
   * glance across a long screen.
   *
   * Decorative, and the caller is expected to pass an `aria-hidden` icon: the
   * title beside it already names the panel, so a described icon is the same
   * label twice. It is a slot rather than a name because the tone is part of the
   * meaning — an overdue panel in red and a settled one in the same grey are
   * different signals, and a component that picked the colour itself could not
   * tell them apart.
   */
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Override for panels holding a full-bleed table or chart. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("rounded-lg border border-slate-200 bg-white", className)}
    >
      {title || action ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                {icon}
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-slate-600">{description}</p>
            ) : null}
          </div>
          {action ? (
            <div className="flex shrink-0 items-center gap-2">{action}</div>
          ) : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function DenseTable({
  className,
  fixed,
  ...props
}: ComponentProps<"table"> & { fixed?: boolean }) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto",
        fixed && "max-h-[70vh] overflow-y-auto"
      )}
    >
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function DenseHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    // `sticky` needs the scroll container above to be the offset parent, which
    // it is: the wrapper inside `DenseTable` is the scroller.
    <thead
      className={cn("sticky top-0 z-10 bg-slate-50", className)}
      {...props}
    />
  );
}

export function DenseBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody className={cn("divide-y divide-slate-100", className)} {...props} />
  );
}

export function DenseRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("transition-colors hover:bg-slate-50/70", className)}
      {...props}
    />
  );
}

export function DenseHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-slate-600",
        className
      )}
      {...props}
    />
  );
}

/** Numeric cells are right-aligned and tabular by default; override via className. */
export function DenseCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn("px-3 py-2 align-top text-slate-800", className)}
      {...props}
    />
  );
}

export function NumHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <DenseHead
      className={cn("text-right tabular-nums", className)}
      {...props}
    />
  );
}

export function NumCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <DenseCell
      className={cn("text-right tabular-nums", className)}
      {...props}
    />
  );
}

export function EmptyRow({
  colSpan,
  children,
  className,
}: {
  colSpan: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          "px-3 py-10 text-center text-sm text-slate-500",
          className
        )}
      >
        {children}
      </td>
    </tr>
  );
}

/**
 * A plain count row, used for the summary figures at the top of the admin and
 * reports screens. `tone` colours the figure rather than the label, so a red
 * number means a number the reader is meant to act on.
 */
/**
 * A row of figures.
 *
 * `loading` and `error` exist because a figure that has not arrived and a figure
 * that is zero are the same picture, and on this platform they mean opposite
 * things. A caller without them writes `figures?.overdue ?? 0`, which is correct
 * arithmetic and a false claim: a request that failed renders a confident red
 * `0` beside "Past their due date", which is a statement about the province made
 * from no data at all. The register's summary is the case this was added for.
 *
 * The figures are never invented. Absent and errored are drawn as an em dash
 * with the reason underneath, which says "not known" rather than "none".
 */
export function StatTable({
  items,
  className,
  loading = false,
  error = null,
}: {
  items: {
    label: string;
    value: number | string;
    detail?: string;
    tone?: string;
  }[];
  className?: string;
  /** No figures yet: draw the shape, not the numbers. */
  loading?: boolean;
  /** Why there are no figures. Wins over `loading`, since an error is not a wait. */
  error?: ReactNode;
}) {
  // The error wins, and it has to: a failed request is also one that will never
  // produce figures, so treating "loading" as the condition would leave a
  // skeleton on screen permanently.
  const waiting = loading && !error;

  return (
    <div>
      <div
        aria-busy={waiting || undefined}
        className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}
      >
        {items.map(item => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              {item.label}
            </p>
            {waiting ? (
              // The card's own shape, so the page does not resize when the
              // figures land.
              <div className="mt-1.5 space-y-1.5" aria-hidden>
                <Skeleton className="h-7 w-12" />
                <Skeleton className="h-3 w-24" />
              </div>
            ) : (
              <>
                <p
                  className={cn(
                    "mt-1.5 text-2xl font-semibold tabular-nums",
                    // An errored figure is muted rather than toned: the colour is
                    // a judgement about the province, and there is no province to
                    // judge.
                    error ? "text-slate-400" : (item.tone ?? "text-slate-900")
                  )}
                >
                  {error ? "—" : item.value}
                </p>
                {item.detail ? (
                  <p className="mt-0.5 text-xs text-slate-600">{item.detail}</p>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
