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
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import superjson from "superjson";

/**
 * Every client-side provider the app needs, in the order they nest.
 *
 * This replaces the `createRoot(...).render(...)` call that used to live in
 * `client/src/main.tsx`. App Router has no client entrypoint, so the same tree
 * is declared here and mounted by `app/layout.tsx`.
 */

function makeClientQueryClient(
  onUnauthorized: (error: unknown) => void
) {
  const client = makeQueryClient();

  client.getQueryCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "error") {
      const error = event.query.state.error;
      onUnauthorized(error);
      console.error("[API Query Error]", error);
    }
  });

  client.getMutationCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "error") {
      const error = event.mutation.state.error;
      onUnauthorized(error);
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
  const router = useRouter();

  const redirectToLoginIfUnauthorized = (error: unknown) => {
    if (!(error instanceof TRPCClientError)) return;
    if (typeof window === "undefined") return;

    const isUnauthorized = isUnauthenticatedError(error);

    if (!isUnauthorized) return;

    if (window.location.pathname === "/login") return;

    router.replace("/login");
  };

  const [queryClient] = useState(() =>
    makeClientQueryClient(redirectToLoginIfUnauthorized)
  );
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
