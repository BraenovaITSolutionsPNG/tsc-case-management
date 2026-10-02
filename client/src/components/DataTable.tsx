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
export function StatTable({
  items,
  className,
}: {
  items: {
    label: string;
    value: number | string;
    detail?: string;
    tone?: string;
  }[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map(item => (
        <div
          key={item.label}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            {item.label}
          </p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-semibold tabular-nums",
              item.tone ?? "text-slate-900"
            )}
          >
            {item.value}
          </p>
          {item.detail ? (
            <p className="mt-0.5 text-xs text-slate-600">{item.detail}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
