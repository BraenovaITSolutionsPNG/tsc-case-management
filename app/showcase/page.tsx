"use client";

import ComponentShowcase from "@/views/ComponentShowcase";

/**
 * The component gallery.
 *
 * This screen was never reachable from the wouter route table - it was a
 * standalone file with no segment pointing at it. It is wired up here because
 * it is genuinely useful for reviewing the shadcn layer after a styling
 * change, and it is safe to leave in: it reads no matter data and renders only
 * presentational components.
 */
export default function Page() {
  return <ComponentShowcase />;
}
