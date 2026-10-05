import { beginSignOut } from "@/lib/postSignIn";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    // Raised before the request, not after. Sign-out ends with the document
    // being replaced, so nothing observable survives it — the only way to cover
    // the gap is to say "this is happening" to something that is about to be
    // destroyed.
    beginSignOut();
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        !(error instanceof TRPCClientError) ||
        error.data?.code !== "UNAUTHORIZED"
      ) {
        // Logged rather than raised. Raising it here propagated out of an
        // `onClick` React never awaits, so it became an unhandled rejection and
        // nothing navigated — leaving the loader this function had just raised
        // covering a page the officer could no longer act on. The navigation
        // below runs either way, so the officer is never left holding a button
        // that appears to do nothing.
        console.error("[Auth] sign-out did not complete cleanly:", error);
      }
    } finally {
      // Cleared whichever way the mutation went. An officer who pressed "sign
      // out" on a machine that must be left signed in has been told this
      // succeeded, so the cached identity is dropped even when the request that
      // would have ended the session failed.
      utils.auth.me.setData(undefined, null);

      // No `invalidate()` here any more. It used to refetch `auth.me` to prove the
      // session was gone, which is work whose only consumer is the document load
      // immediately below — so all it could do was delay the thing the officer is
      // waiting for. Setting the cache to null is what makes the brief moment
      // before the document is replaced agree that they are signed out.

      // A full document load, which is what the loader raised above is counting
      // on. `PlatformPageLoader` lives in the root layout and its only dismissal
      // is a post-sign-in handover, so a client-side route away from here leaves
      // it up: the officer got a full-screen branded loader over the sign-in
      // form, and since the only way to lower it is to sign in again, they could
      // not. Replacing the document destroys the loader with everything else,
      // which is also why the session is re-resolved server-side on the first
      // paint rather than the app rendering a signed-out shell.
      window.location.assign(redirectPath ?? "/login");
    }
  }, [logoutMutation, redirectPath, utils]);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
      /**
       * A sign-out in progress, as distinct from `loading`.
       *
       * `loading` folds this in, which is right for a layout that just wants to
       * know whether to show something provisional. It is wrong for a screen that
       * has to choose *which* provisional thing: the layout reads `loading` and
       * reaches for its skeleton, so an officer pressing Sign out got a skeleton
       * of a page they had just left rather than the platform's loader.
       */
      signingOut: logoutMutation.isPending,
    }),
    [
      meQuery.data,
      meQuery.error,
      meQuery.isLoading,
      logoutMutation.error,
      logoutMutation.isPending,
    ]
  );

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Go to the sign-in screen. Nothing is started from here: the session lives
    // in an httpOnly cookie this code cannot read, so an officer who is signed
    // out is discovered by `auth.me` answering null and not by any local state.
    // A full navigation rather than a client route, so the server resolves the
    // session on the first paint instead of the app rendering a signed-out shell
    // and correcting itself.
    window.location.href = redirectPath ?? "/login";
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
