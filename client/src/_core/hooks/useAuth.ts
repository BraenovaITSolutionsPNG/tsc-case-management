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
    // Raised before the request, not after. Sign-out ends in a full document
    // load of the sign-in screen, so nothing observable survives it — the only
    // way to cover the gap is to say "this is happening" to something that is
    // about to be destroyed.
    beginSignOut();
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Cleared whichever way the mutation went. An officer who pressed "sign
      // out" on a machine that must be left signed in has been told this
      // succeeded, so the cached identity is dropped even when the request that
      // would have ended the session failed.
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

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
