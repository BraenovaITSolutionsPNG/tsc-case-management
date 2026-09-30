"use client";

import { trpc } from "@/lib/trpc";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from "@shared/const";
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
 * This deliberately does not call `startLogin()`. That launches the identity
 * provider's flow, and in development it falls through to `/api/dev/login`,
 * which signs the visitor in as the dev owner without being asked — so a
 * signed-out officer was quietly given a session instead of being shown the
 * sign-in form. The sign-in page is the one place credentials are entered, and
 * an expired session belongs there, carrying the path they were on so they
 * land back on it afterwards.
 */
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Already on the sign-in page: reloading it would loop, and a 401 there is
  // simply the expected answer to an auth probe.
  const { pathname, search } = window.location;
  if (pathname === "/login") return;

  // Runs inside a react-query cache subscriber, so a throw here would escape
  // into the cache rather than surface to the user.
  try {
    const target = `${pathname}${search}`;
    window.location.assign(
      target ? `/login?next=${encodeURIComponent(target)}` : "/login"
    );
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
        headers() {
          // Preview auto-login fallback: when the browser blocks iframe
          // cookies (Safari ITP / private browsing / WebView), the runtime
          // mirrors the session into sessionStorage so we can forward it as a
          // Bearer token. The regular OAuth cookie flow keeps working and takes
          // priority server-side.
          try {
            const raw = sessionStorage.getItem("manus-cookie");
            if (raw) {
              const prefix = `${COOKIE_NAME}=`;
              const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
              const token = pair?.trim().slice(prefix.length);
              if (token) {
                return { Authorization: `Bearer ${token}` };
              }
            }
          } catch {
            // sessionStorage unavailable
          }
          return {};
        },
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
        <ThemeProvider defaultTheme="light">
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
