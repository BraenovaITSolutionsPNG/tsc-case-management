"use client";

import { trpc } from "@/lib/trpc";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isUnauthenticatedError } from "@shared/unauthed";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { makeQueryClient } from "@shared/queryClient";
import { useState, type ReactNode } from "react";
import superjson from "superjson";

/**
 * Every client-side provider the app needs, in the order they nest.
 *
 * This replaces the `createRoot(...).render(...)` call that used to live in
 * `client/src/main.tsx`. App Router has no client entrypoint, so the same tree
 * is declared here and mounted by `app/layout.tsx`.
 */

/**
 * Send an officer whose session has expired to the sign-in page.
 *
 * Nothing is signed anyone in here. The development login route that used to
 * be reached from this path signed the visitor in as the platform owner without
 * being asked, so a signed-out officer was quietly given a session instead of
 * being shown the form. The sign-in page is the one place credentials are
 * entered, and an expired session belongs there, carrying the path they were on
 * so they land back on it afterwards.
 */
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = isUnauthenticatedError(error);

  if (!isUnauthorized) return;

  // Already on the sign-in page: reloading it would loop, and a 401 there is
  // simply the expected answer to an auth probe.
  if (window.location.pathname === "/login") return;

  // Runs inside a react-query cache subscriber, so a throw here would escape
  // into the cache rather than surface to the user.
  //
  // No `next`. An expired session used to carry the path it expired on, so the
  // officer would be returned to it — which by then may be a closed matter, a
  // reassigned one, or one they have lost the capability to open. `LANDING_PATH`
  // is the overview, which every role can reach and which always answers the
  // same question.
  try {
    window.location.assign("/login");
  } catch (error) {
    console.error("[Auth] Redirect to sign-in failed", error);
  }
};

function makeClientQueryClient() {
  const client = makeQueryClient();

  // A session that expired mid-flight should send the officer back to the login
  // screen rather than leaving a half-broken dashboard, so both query and
  // mutation errors are watched for UNAUTHORIZED.
  client.getQueryCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "error") {
      const error = event.query.state.error;
      redirectToLoginIfUnauthorized(error);
      console.error("[API Query Error]", error);
    }
  });

  client.getMutationCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "error") {
      const error = event.mutation.state.error;
      redirectToLoginIfUnauthorized(error);
      console.error("[API Mutation Error]", error);
    }
  });

  return client;
}

function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        // No Authorization header is set. The Supabase session cookie is
        // httpOnly, so the browser sends it with `credentials: "include"` below
        // and this code never handles a token. The old header path existed to
        // mirror the session into sessionStorage for browsers that block iframe
        // cookies; carrying a copy of the session in script-readable storage is
        // a worse trade than asking an officer to sign in again.
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
    ],
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // Both are created per mount rather than as module-level singletons. Client
  // components are rendered on the server too, and a shared cache or link
  // chain would leak one visitor's data into another's server render.
  const [queryClient] = useState(makeClientQueryClient);
  const [trpcClient] = useState(makeTrpcClient);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/*
          `switchable`, so this provider owns the theme: it restores the stored
          choice on mount and writes it back on every change. Without it the
          provider kept `defaultTheme` and its effect removed the `dark` class
          on every mount, so the choice `Settings` saved could never survive a
          reload — the setting screen said "Light" while `localStorage` still
          held `"dark"`.
        */}
        <ThemeProvider defaultTheme="light" switchable>
          <TooltipProvider>
            <Toaster />
            {/*
              The cache inspector, for development only.
              `process.env.NODE_ENV` is replaced at build time, so the branch is
              dead in a production build and the devtools are dropped from the
              bundle rather than shipped behind a flag an officer could find.
              It is mounted inside the provider because it reads the same cache
              the screens do, and it is worth having here rather than in a
              component: with ~40 mutations across three routers, the question
              "which mutation forgot to invalidate" is otherwise only answerable
              by reading the source.
            */}
            {process.env.NODE_ENV === "development" ? (
              <ReactQueryDevtools initialIsOpen={false} />
            ) : null}
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
