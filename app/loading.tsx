"use client";

import { PageLoader } from "@/components/BrandLoader";

/**
 * Root loading UI — shows a full-screen branded loader until the route
 * (server render + client hydration) is completely ready.
 *
 * This replaces the progressive skeleton approach with a single blocking
 * loader so the officer sees the complete page in one paint rather than
 * watching pieces arrive.
 */
export default function Loading() {
  return <PageLoader label="Loading TSC Case Management" />;
}