"use client";

import NotFound from "@/views/NotFound";

/**
 * The 404 the App Router renders for any URL that matches no route segment.
 *
 * This is where wouter's trailing `<Route component={NotFound} />` catch-all
 * used to live. The segment is a client component because the view navigates
 * with `useRouter`, which has no server implementation.
 */
export default function NotFoundPage() {
  return <NotFound />;
}
