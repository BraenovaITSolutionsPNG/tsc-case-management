import type { NextConfig } from "next";

/**
 * `next dev` and `next build` both write to `.next/`, and a production build
 * deletes what the dev server had cached. Running one while the other is
 * serving does not degrade gracefully: the dev server comes back up serving
 * production chunks with no cache of its own, so every route and every click
 * pays a full cold Turbopack compile — measured at 27s, then 58s, then 98s to
 * rebuild the same code, growing with each build.
 *
 * Giving development its own directory means the two can run at once and a
 * build can no longer take the dev server down. `NEXT_DIST_DIR` is set by the
 * `dev` script; without it the default `.next` is kept, so `build` and `start`
 * are unaffected.
 */
const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),

  // tRPC, Drizzle and the shared rule modules all live outside app/, so file
  // tracing has to be rooted at the repository rather than the app directory or
  // the standalone/serverless bundles drop them.
  outputFileTracingRoot: import.meta.dirname,

  // No `eslint` key. Next 16 removed support for it and warns on every build
  // that it is present, which is the worst kind of warning: it trains you to
  // ignore the output of the build. It was only ever here to skip linting, and
  // there is nothing to skip — eslint is not a dependency and there is no config,
  // so `next lint` has never run in this project. Type errors are not ignored
  // (`typescript.ignoreBuildErrors` below is false), which is the check that does
  // run.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
