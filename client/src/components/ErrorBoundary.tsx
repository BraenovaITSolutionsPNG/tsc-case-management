import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Whether a stack trace is safe to put on screen.
 *
 * Only in development. A production stack carries absolute paths on the server,
 * the names of internal modules, and whatever was in the values being rendered
 * when it threw — none of which belongs in front of an officer, and all of
 * which is free to hand an outsider a map of the deployment. The trace is still
 * logged; what is withheld is the officer's copy of it.
 */
const SHOW_STACK = process.env.NODE_ENV !== "production";

/**
 * The recovery card shown when a render throws.
 *
 * Extracted so App Router's `app/error.tsx` can present exactly the same
 * surface as the in-tree boundary - previously only the latter existed, and
 * duplicating the markup would let the two drift apart.
 */
export function ErrorCard({
  error,
  onRetry,
}: {
  error: (Error & { digest?: string }) | null;
  /** Defaults to a full reload, which is all a hard-failed tree can do. */
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-background">
      <div className="flex flex-col items-center w-full max-w-2xl p-8">
        <AlertTriangle
          size={48}
          className="text-destructive mb-6 flex-shrink-0"
          aria-hidden
        />

        <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

        <p className="mb-6 w-full text-center text-sm text-muted-foreground">
          The platform stopped while drawing this page. Nothing was saved.
          Reload to try again, and if it keeps happening, tell an administrator
          {error?.digest ? (
            <>
              {" "}
              and quote the reference{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {error.digest}
              </code>
            </>
          ) : null}
          .
        </p>

        {SHOW_STACK && error?.stack ? (
          <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
            <pre className="text-sm text-muted-foreground whitespace-break-spaces">
              {error.stack}
            </pre>
          </div>
        ) : null}

        <button
          onClick={onRetry ?? (() => window.location.reload())}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg",
            "bg-primary text-primary-foreground",
            "hover:opacity-90 cursor-pointer"
          )}
        >
          <RotateCcw size={16} aria-hidden />
          Reload Page
        </button>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  /**
   * Logged, not only rendered.
   *
   * `app/error.tsx` logs its failures, and this boundary catches everything
   * above that file — the providers and the root layout — so it was the one
   * place a crash could vanish entirely: the officer saw a card, and nothing
   * anywhere recorded what had thrown or where. In a platform whose whole
   * purpose is an accountability trail, a failure that leaves no trace is the
   * worst kind.
   */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] render failed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorCard error={this.state.error} />;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
