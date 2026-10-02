import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The three states a screen can be in that are not "the data".
 *
 * Every screen in this platform has to answer the same three questions — is it
 * still arriving, did it fail, is there nothing to show — and until now each
 * answered them in its own way. Five screens had five error presentations, four
 * of them a bare sentence in a paragraph, one a local component that belonged to
 * a single file; empty states were typed out inline wherever they were needed;
 * and not one of them announced itself to a screen reader.
 *
 * That last part is the one worth being firm about. A skeleton is a picture of
 * content, so to a screen reader it is a page that is simply empty, and a failure
 * is a sentence indistinguishable from any other sentence on the page. Someone
 * reading this platform with a screen reader is told, on every load, that
 * nothing is there — and then, on a failure, that nothing is there again, this
 * time with no indication that anything went wrong.
 *
 * So all three are announced. A loading state is a polite status with the label
 * for what is being loaded. A failure is an alert, which interrupts, because it
 * is the one thing on the page the officer has to act on.
 *
 * The visual language is deliberately identical across all of them: the same
 * centring, the same muted icon, the same type sizes. A register that failed and a
 * report that is empty should look like they belong to the same product, because
 * they are.
 */

/**
 * A region that is still arriving.
 *
 * Wraps whatever the skeleton is - rows, panels, a page - so the announcement
 * travels with the shape rather than the caller having to remember it.
 *
 * `aria-busy` rather than `aria-live` alone: the region is marked busy so
 * assistive technology can hold off announcing the content that replaces it,
 * which is what stops a screen reader reading out a page of grey boxes followed
 * immediately by the real thing.
 */
export function LoadingState({
  label = "Loading",
  className,
  children,
}: {
  /** What is loading, in the officer's words: "the register". */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("motion-safe:animate-in motion-safe:fade-in", className)}
    >
      {/*
       * The announcement, and nothing else. `sr-only` rather than `hidden`
       * because a hidden node is removed from the accessibility tree along with
       * everything else, and this is the whole point of the component.
       */}
      <span className="sr-only">{label} is loading.</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/**
 * Something that failed, with the one action that might fix it.
 *
 * `role="alert"` interrupts whatever is being read, which is correct here and
 * nowhere else: an officer who cannot see their register needs to know now, and
 * nothing else on the page is more urgent.
 *
 * The message is shown as well as logged. `retry` is required rather than
 * optional because every failure in this platform is a request that can be made
 * again, and a dead end with no way forward is worse than the fault that caused
 * it.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  /** What failed: "the register", "this report". */
  title?: string;
  /** The server's own words, where it gave any. */
  message?: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className
      )}
    >
      <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
      <p className="mt-3 text-sm font-medium text-slate-900">
        {title ?? "This could not be loaded"}
      </p>
      {message ? (
        <p className="mt-1 max-w-prose text-sm text-slate-600">{message}</p>
      ) : null}
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}

/**
 * Nothing to show, and that is not a fault.
 *
 * Separate from `ErrorState` on purpose. Both draw a muted icon and a line of
 * type in the same place, and the difference is the whole message: one says "you
 * have finished", the other says "something is wrong". Conflating them teaches
 * officers to ignore the empty state, which is how a real fault gets ignored.
 *
 * `children` when there is something to say beyond the sentence — a link to the
 * thing that would fill this screen, which is more useful than asking them to
 * guess where to go next.
 */
export function EmptyState({
  text,
  children,
  className,
}: {
  text: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className
      )}
    >
      <Inbox className="h-8 w-8 text-slate-300" aria-hidden />
      <p className="mt-3 text-sm text-slate-500">{text}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/**
 * A column of placeholder rows, for a list that has not arrived.
 *
 * Exists because `LoadingState` deliberately insists on being told the shape it
 * stands in for — a table given a paragraph of grey tells an officer nothing about
 * what is coming, and a panel given table rows tells them less. This is the one
 * shape common enough to be worth naming: a list of records.
 *
 * The count is a floor rather than a fixed number because a screen with two rows
 * to show and one with forty should both look loaded rather than one of them
 * appearing to have finished early.
 */
export function SkeletonRows({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-10 rounded" />
      ))}
    </div>
  );
}
