import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

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
  error: Error | null;
  /** Defaults to a full reload, which is all a hard-failed tree can do. */
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-background">
      <div className="flex flex-col items-center w-full max-w-2xl p-8">
        <AlertTriangle
          size={48}
          className="text-destructive mb-6 flex-shrink-0"
        />

        <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

        <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
          <pre className="text-sm text-muted-foreground whitespace-break-spaces">
            {error?.stack}
          </pre>
        </div>

        <button
          onClick={onRetry ?? (() => window.location.reload())}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg",
            "bg-primary text-primary-foreground",
            "hover:opacity-90 cursor-pointer"
          )}
        >
          <RotateCcw size={16} />
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

  render() {
    if (this.state.hasError) {
      return <ErrorCard error={this.state.error} />;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
