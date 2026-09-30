import { PageLoader } from "@/components/BrandLoader";

/**
 * The loading state for every page in the app.
 *
 * App Router renders this the moment a navigation starts and swaps it for the
 * real screen when the route resolves, so it is the one place a loader has to
 * live to cover every page rather than each screen remembering to draw its own.
 * Every screen still keeps its skeletons — this is the wait *between* pages, not
 * the wait for data once a page is already up.
 *
 * It is a Server Component, so it can be prerendered with the rest of the shell
 * and costs nothing until it is actually shown.
 */
export default function Loading() {
  return <PageLoader />;
}
