import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The page chrome every screen sits inside: an optional eyebrow, a title, a
 * description of what the screen is for, and a right-hand action.
 *
 * `PageShell` is the outer frame. It exists as its own export because every
 * screen wraps itself in it inside `DashboardLayout`, and pulling the padding
 * out of `PageHeader` lets a screen that needs a full-bleed table opt out
 * without re-deriving the spacing.
 */

export function PageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto w-full max-w-[1600px] space-y-5", className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  /** Small label above the title: which section or manual clause this is. */
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">
            {eyebrow}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2">
          {Icon ? <Icon className="h-5 w-5 text-slate-400" /> : null}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
        </div>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
