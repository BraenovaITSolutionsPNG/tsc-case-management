"use client";

import { CardPanel } from "@/components/DataTable";
import DashboardLayout from "@/components/DashboardLayout";
import { AvatarUpload } from "@/components/AvatarUpload";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { can, capabilitiesFor, capabilityLabel } from "@shared/access";
import { useTheme } from "@/contexts/ThemeContext";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_TITLES } from "@shared/roles";
import {
  GOLDEN_RULE_PARTS,
  MATTER_CATEGORIES,
  NATIONAL_SECTIONS,
} from "@shared/delegation";
import { STATUS_LABELS, STATUS_VALUES } from "@shared/statuses";
import { LogOut, Monitor, Moon, ShieldCheck, Sun, UserCog } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The officer's own account, and what this deployment of the platform is.
 *
 * Scope note, because it explains the shape of this screen: there is no route
 * that lets an officer edit their own name, email or role, and that is
 * deliberate rather than unfinished. The manual requires every office that handles a
 * matter to stay identifiable, and a name an officer can quietly change would
 * break the accountability trail — a matter registered by "J. Otieno" and later
 * attributed to someone else is not an identifiable trail. Roles are provisioned
 * by the platform administrator for the same reason.
 *
 * What the officer does control is their photograph, their appearance, and their
 * local sign-in credential where the deployment has one. The credential is
 * deliberately not self-service either: `setPassword` is an administrator
 * capability, and a forgotten password is resolved by the platform
 * administrator, who can see the account is real.
 */

export default function Settings() {
  const { logout, signingOut, refresh } = useAuth();
  const me = trpc.auth.me.useQuery();

  if (me.isLoading) {
    return (
      <DashboardLayout>
        <PageShell>
          <LoadingState label="Your account">
            <Skeleton className="h-64 rounded-lg" />
          </LoadingState>
        </PageShell>
      </DashboardLayout>
    );
  }

  if (me.error || !me.data) {
    return (
      <DashboardLayout>
        <PageShell>
          {/* `role="alert"` for the same reason as the matter that could not be
              opened: this is a state the officer has to notice, and a screen
              reader was reading it as an ordinary heading. */}
          <div
            role="alert"
            className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center"
          >
            <UserCog className="mx-auto h-9 w-9 text-slate-300" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold text-slate-900">
              You are not signed in
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">{me.error?.message}</p>
            <Button asChild variant="secondary" className="mt-5">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </PageShell>
      </DashboardLayout>
    );
  }

  const user = me.data;
  const capabilities = capabilitiesFor(user.role);

  return (
    <DashboardLayout>
      <PageShell>
        <PageHeader
          eyebrow="Your account"
          title="Settings"
          description="Your photograph, your appearance, your sign-in, and what this platform is built on."
          icon={UserCog}
        />

        {/* Two columns, not one long one. The page is given the full width of
            the shell, so the question is what fills it: a single column of
            cards stretched to 1600px would put a 200-character line of prose
            across the screen, which is the width nobody reads. Instead the
            officer's own account sits on the left at a comfortable measure and
            the reference tables — which are genuinely wide, and are lists of
            short parallel facts rather than sentences — take the wider right
            column and set two abreast. Below `xl` this collapses to the one
            column it always was. */}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-5">
            <CardPanel
              title="Profile"
              description="Your name and role are provisioned by the platform administrator, so that every matter stays attributable."
            >
              <AvatarUpload
                avatarKey={user.avatarKey}
                name={user.name}
                size={64}
                onChange={() => void refresh()}
              />

              <dl className="mt-5 space-y-3 text-sm">
                <Row label="Name" value={user.name ?? "—"} />
                <Row label="Email" value={user.email ?? "—"} />
                <Row
                  label="Sign-in name"
                  value={
                    user.username ? (
                      <span className="font-mono text-xs">{user.username}</span>
                    ) : (
                      <span className="text-slate-500">
                        Set by your identity provider
                      </span>
                    )
                  }
                />
                <Row label="Role" value={ROLE_LABELS[user.role]} />
                <Row label="Title" value={ROLE_TITLES[user.role]} />
                <Row
                  label="Last signed in"
                  value={formatDateTime(user.lastSignedIn)}
                />
              </dl>

              <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                {ROLE_DESCRIPTIONS[user.role]}
              </p>
            </CardPanel>

            <AppearancePanel />

            <CardPanel
              title="Sign-in credential"
              description="Where this deployment signs officers in."
            >
              {user.username ? (
                <>
                  <p className="text-sm text-slate-700">
                    You sign in with the name{" "}
                    <span className="font-mono text-xs font-medium">
                      {user.username}
                    </span>{" "}
                    and a password.
                  </p>
                  {can(user.role, "platform:users") ? (
                    <p className="mt-2 text-xs text-slate-500">
                      As a platform administrator you can set or replace any
                      officer&apos;s credential on the admin screen.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      A forgotten password is reset by the platform
                      administrator — ask them rather than creating a second
                      account.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-700">
                  This account signs in through the Commission&apos;s identity
                  provider. There is no local password to change.
                </p>
              )}

              <Button
                variant="outline"
                className="mt-4"
                disabled={signingOut}
                onClick={() => void logout()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </CardPanel>

            <DevicesPanel />

            <CardPanel
              title="What your role can do"
              description="The capabilities the server enforces on your account, not just the options this screen shows."
            >
              {capabilities.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No capabilities are held by this role.
                </p>
              ) : (
                // Two abreast from `sm`: a platform administrator holds fifteen
                // of these, and a single column of fifteen is a wall to scroll
                // past to reach the reference below it.
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {capabilities.map(capability => (
                    <li
                      key={capability}
                      className="flex items-start gap-2 text-sm text-slate-700"
                    >
                      <ShieldCheck
                        className="mt-0.5 h-4 w-4 shrink-0 text-teal-600"
                        aria-hidden
                      />
                      {capabilityLabel(capability)}
                    </li>
                  ))}
                </ul>
              )}
              {capabilities.length ? (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Hiding an option is a courtesy, not a security control: each
                  one is also enforced on the route, so calling the API directly
                  cannot bypass it.
                </p>
              ) : null}
            </CardPanel>
          </div>

          <CardPanel
            title="Reference"
            description="The manual this platform implements, held in shared/ as the single source of truth."
          >
            <ReferenceList />
          </CardPanel>
        </div>
      </PageShell>
    </DashboardLayout>
  );
}

/**
 * Appearance. The theme is the one genuinely self-service setting in the
 * platform, and it is deliberately a local preference: it belongs to the
 * browser the officer is sitting at, not to the account, so two officers
 * sharing a machine in a provincial office are not fighting over it.
 */
/**
 * Where this account is signed in, and a way to end the sessions that are not
 * this one.
 *
 * `Sign out` above ends whichever session the officer is using, which leaves them
 * stuck if they are *also* signed in somewhere else — a laptop lent to a colleague,
 * a phone left in a drawer, a session on a machine they no longer have. An officer
 * who suspects that has no way to deal with it, because nothing in the platform
 * lists their sessions and nothing ends one but their own.
 *
 * So this lists them. The one in use is marked and cannot be ended from here:
 * doing so would invalidate the session in Supabase while the browser keeps the
 * cookie, leaving an officer holding a dead session that fails every request. That
 * is what Sign out is for.
 */
function DevicesPanel() {
  const utils = trpc.useUtils();
  const [confirmingAll, setConfirmingAll] = useState(false);

  const sessions = trpc.auth.sessions.useQuery(undefined, {
    // Devices change slowly and only when the officer does something. A stale
    // list is better than one that refetches on every window focus, and
    // `refetchOnWindowFocus` is off platform-wide for the same reason.
    staleTime: 30_000,
  });

  const revokeOther = trpc.auth.revokeOtherSessions.useMutation({
    onSuccess: result => {
      setConfirmingAll(false);
      toast.success(
        result.ended === 0
          ? "There were no other devices signed in."
          : `Signed out ${result.ended} other ${
              result.ended === 1 ? "device" : "devices"
            }.`
      );
      void utils.auth.sessions.invalidate();
    },
    onError: cause => toast.error(cause.message),
  });

  const revokeOne = trpc.auth.revokeSession.useMutation({
    onSuccess: () => {
      toast.success("That device has been signed out.");
      void utils.auth.sessions.invalidate();
    },
    onError: cause => toast.error(cause.message),
  });

  const data = sessions.data;

  if (sessions.isLoading) {
    return (
      <CardPanel title="Where you're signed in">
        <Skeleton className="h-24 rounded-lg" />
      </CardPanel>
    );
  }

  // Before the capability branch, and separately from it. `!data?.available`
  // catches a failed request as well as an absent capability, which had this
  // screen telling an officer their *deployment* cannot manage devices because
  // one request did not come back — a claim about the platform's
  // configuration, offered with no way to retry and no way to tell it apart
  // from a real one.
  if (sessions.isError) {
    return (
      <CardPanel title="Where you're signed in">
        <ErrorState
          title="Your signed-in devices could not be read"
          message={sessions.error?.message}
          onRetry={() => void utils.auth.sessions.invalidate()}
        />
      </CardPanel>
    );
  }

  if (!data?.available) {
    return (
      <CardPanel
        title="Where you're signed in"
        description="This deployment cannot manage signed-in devices."
      >
        <p className="text-sm text-slate-600">
          Sign out still ends this device. To end a session on another device,
          ask the platform administrator.
        </p>
      </CardPanel>
    );
  }

  const others = data.sessions.filter(session => !session.current);
  const current = data.sessions.find(session => session.current);

  return (
    <CardPanel
      title="Where you're signed in"
      description="Every browser currently holding a session for this account."
    >
      {current ? (
        <DeviceRow session={current} badge="This device" />
      ) : (
        <p className="text-sm text-slate-600">
          {data.currentKnown
            ? "This device is not in the list, which usually means the list is out of date."
            : "This deployment cannot tell your devices apart, so only Sign out can end one."}
        </p>
      )}

      {others.length ? (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Other devices
          </p>
          <ul className="mt-2 space-y-2">
            {others.map(session => (
              <li key={session.id}>
                <DeviceRow
                  session={session}
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revokeOne.isPending}
                      onClick={() =>
                        revokeOne.mutate({ sessionId: session.id })
                      }
                    >
                      Sign out
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-600">
          No other device is signed in.
        </p>
      )}

      {/*
       * Two steps, deliberately. This ends sessions on machines the officer is
       * not looking at, which is not something to do on a single click that
       * looks like saving a preference — and the failure mode if it were is
       * somebody else being signed out of the platform mid-task with no way to
       * tell why.
       */}
      {others.length > 0 ? (
        <div className="mt-4">
          {confirmingAll ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-slate-800">
                Sign out {others.length} other{" "}
                {others.length === 1 ? "device" : "devices"}? Anyone using{" "}
                {others.length === 1 ? "it" : "them"} will be returned to the
                sign-in screen.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={revokeOther.isPending}
                  onClick={() => revokeOther.mutate()}
                >
                  {revokeOther.isPending
                    ? "Signing out…"
                    : "Yes, sign them out"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmingAll(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirmingAll(true)}>
              Sign out all other devices
            </Button>
          )}
        </div>
      ) : null}
    </CardPanel>
  );
}

function DeviceRow({
  session,
  badge,
  action,
}: {
  session: {
    device: string;
    ipAddress: string | null;
    lastActiveAt: Date | string | null;
    signedInAt: Date | string | null;
  };
  badge?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">
          {session.device}
          {badge ? (
            <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-800">
              {badge}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {session.ipAddress ? `${session.ipAddress} · ` : ""}
          {session.lastActiveAt
            ? `last active ${formatDateTime(session.lastActiveAt)}`
            : session.signedInAt
              ? `signed in ${formatDateTime(session.signedInAt)}`
              : "activity unknown"}
        </p>
      </div>
      {action}
    </div>
  );
}

function AppearancePanel() {
  // Read from the provider rather than keeping a second copy. The panel used to
  // hold its own `useState("light")`, set the document class itself and write
  // `localStorage` — while the provider, which owns that class, ignored the
  // stored value and reset to light on every mount. The officer's choice looked
  // like it took, and did not survive a reload.
  const { theme, setThemeValue } = useTheme();

  const choose = (next: "light" | "dark") => {
    setThemeValue?.(next);
  };

  return (
    <CardPanel title="Appearance" description="Applies to this browser only.">
      <div className="flex gap-2">
        <Button
          variant={theme === "light" ? "secondary" : "outline"}
          size="sm"
          onClick={() => choose("light")}
        >
          <Sun className="mr-2 h-4 w-4" />
          Light
        </Button>
        <Button
          variant={theme === "dark" ? "secondary" : "outline"}
          size="sm"
          onClick={() => choose("dark")}
        >
          <Moon className="mr-2 h-4 w-4" />
          Dark
        </Button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        <Monitor className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        Held in this browser rather than on your account, so a shared machine in
        a provincial office does not carry one officer&apos;s preference into
        another&apos;s session.
      </p>
    </CardPanel>
  );
}

/** The reference tables, read from the same modules the server enforces. */
function ReferenceList() {
  return (
    // Two columns of sections, not one long list. Each entry is a short fact
    // beside a code or a label, so they sit comfortably side by side; stacked in
    // a single column they ran the length of a screen to say four things.
    <div className="grid gap-x-8 gap-y-6 text-sm sm:grid-cols-2">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Status codes
        </h3>
        <ul className="mt-2 space-y-1">
          {STATUS_VALUES.map(status => (
            <li key={status} className="flex gap-2 text-xs text-slate-700">
              <span className="w-8 shrink-0 font-mono font-medium text-slate-500">
                {status}
              </span>
              {STATUS_LABELS[status]}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Classes of matter
        </h3>
        <ul className="mt-2 space-y-1">
          {MATTER_CATEGORIES.map(category => (
            <li key={category} className="text-xs text-slate-700">
              {category}
            </li>
          ))}
        </ul>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-600">
          The Golden Rule
        </h3>
        <ul className="mt-2 space-y-1">
          {GOLDEN_RULE_PARTS.map(part => (
            <li key={part.key} className="text-xs text-slate-700">
              {part.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="sm:col-span-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          National Sections
        </h3>
        {/* Full width across both columns: each entry pairs a section with the
            authority it holds, and that pair reads as one line only when it is
            not wrapped in half the space. */}
        <ul className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {NATIONAL_SECTIONS.map(section => (
            <li key={section.key} className="text-xs text-slate-700">
              <span className="font-medium text-slate-800">
                {section.label}
              </span>{" "}
              — {section.authority}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Utilities

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function formatDateTime(value?: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
