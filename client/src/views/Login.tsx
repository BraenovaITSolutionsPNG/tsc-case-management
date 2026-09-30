"use client";

import { isOAuthConfigured, startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrganisationLogos } from "@/components/OrganisationLogos";
import { PageLoader } from "@/components/BrandLoader";
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  User,
} from "lucide-react";
import officeIllustration from "@assets/login-bg-img/added-img.webp";
import { GOLDEN_RULE_PARTS } from "@shared/delegation";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/**
 * The sign-in screen.
 *
 * Two ways in, and which of them is offered is decided by how this deployment
 * is configured rather than by the browser:
 *
 * - The Commission's identity provider (OAuth). Offered only when
 *   `isOAuthConfigured` is true, because `startLogin()` throws when the portal
 *   is absent outside development, and a button that throws is worse than no
 *   button at all.
 * - Username and password, checked by `handleLogin`. This is the path this
 *   instance uses, in development and in production alike, because the identity
 *   provider is not configured here.
 *
 * There is no way to create an account from here. Officers are registered by
 * the platform administrator on the admin screen, which is also where a role is
 * assigned — the manual makes the office that receives an application
 * identifiable (§15), so an account cannot be self-issued at the front door. The
 * setup tab that used to sit on this screen allowed any visitor to name a role,
 * and has been removed.
 *
 * On presentation: two panels. The illustration runs full-bleed down one side
 * and the form down the other, which is the arrangement a sign-in screen uses
 * when the product is a place rather than a tool — the officer sees the office
 * they are signing in to before they see a field to type in. The artwork shows
 * a provincial office at work: officers round a table, a case file, the workflow
 * a matter travels, and the regional map. It is decorative, so it is hidden from
 * assistive technology rather than described, and it is `priority` because it is
 * the largest thing on the first paint — deferring it would delay the page.
 *
 * The card's own detailing follows Material 3 rather than the older WordPress
 * chrome: generously rounded fields, a filled tonal treatment for the error
 * rather than a red outline, and a single accent colour carried through the
 * focus ring, the button and the rules on the illustration side. The two
 * languages agree on the thing that matters, which is that the card is the only
 * part of the page that can be interacted with.
 */

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { isAuthenticated, loading } = useAuth();
  const next = params.get("next") ?? undefined;

  // An already-signed-in officer arriving here is sent on. This is a client
  // redirect rather than a server one because `/login` is a client component
  // and the session lives in an httpOnly cookie this code cannot read.
  useEffect(() => {
    if (isAuthenticated) router.replace(next ?? "/");
  }, [isAuthenticated, next, router]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Material's pattern: the field is obscured by default, and the officer can
  // look at what they typed without the page having to leave a password in plain
  // sight over their shoulder. State lives here rather than on the input so the
  // toggle is a real button, reachable by keyboard and announced.
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/local/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, next }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        next?: string;
      };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That username and password were not accepted.");
        return;
      }
      // The session is now in the cookie; a hard navigation lets the server
      // pick it up on the first paint instead of routing through a stale
      // client-side cache.
      window.location.assign(data.next ?? next ?? "/");
    } catch {
      setError(
        "The sign-in service could not be reached. Try again in a moment."
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading || isAuthenticated) {
    return <PageLoader label="Checking your session" />;
  }

  return (
    /* Two panels rather than a card on a wash. A full-bleed illustration down
       one side and the form down the other is the arrangement a sign-in screen
       uses when the product is a place rather than a tool: the officer sees the
       office they are signing in to, and the form is the only other thing on
       the page. Below `lg` the illustration becomes a short band above the form
       and the layout stacks. */
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      {/* Decorative: it carries no information the form does not, so it is
          hidden from assistive technology rather than described. */}
      <div
        className="relative hidden overflow-hidden bg-teal-900 lg:block"
        aria-hidden
      >
        <Image
          src={officeIllustration}
          alt=""
          width={1408}
          height={768}
          priority
          sizes="(min-width: 1024px) 55vw, 0px"
          className="h-full w-full object-cover"
        />
        {/* Two washes, not one. The teal ties the artwork to the button colour
            so the two halves read as one screen, and the vertical wash at the
            bottom is what makes the caption legible over the busiest part of
            the illustration without darkening the officers' faces at the top. */}
        <div className="absolute inset-0 bg-gradient-to-br from-teal-950/70 via-teal-900/25 to-teal-950/85" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-teal-950/90 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-10">
          <p className="max-w-md text-2xl font-semibold leading-snug tracking-tight text-white">
            Every teacher matter accounted for, from receipt to recorded
            outcome.
          </p>
          <p className="mt-3 max-w-md text-sm leading-6 text-teal-100/80">
            Provincial matters administration following the Kenya Teachers
            Service Commission Provincial Matters Administration Manual.
          </p>

          {/* The Golden Rule as four marks, on the same footing as the officers
              it governs. Quoting it here — before there is an account to
              attribute anything to — is the one piece of advocacy this screen
              does, and it is the platform's own. */}
          <ul className="mt-8 grid max-w-lg grid-cols-2 gap-x-8 gap-y-2.5">
            {GOLDEN_RULE_PARTS.map(part => (
              <li
                key={part.key}
                className="flex items-start gap-2 text-xs leading-5 text-teal-50/90"
              >
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />
                {part.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative flex items-center justify-center overflow-hidden bg-slate-50 px-4 py-10 sm:px-8 sm:py-14">
        {/* The same artwork, cropped to a band, for the stacked layout. It is
            given the same decorative treatment rather than a second, different
            one — the small screen is the same page, not a lesser version. */}
        <div className="absolute inset-x-0 top-0 h-40 lg:hidden" aria-hidden>
          <Image
            src={officeIllustration}
            alt=""
            width={1408}
            height={768}
            priority
            sizes="100vw"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-teal-950/75 to-teal-950/25" />
        </div>

        <div className="relative w-full max-w-[26rem]">
          {/* WordPress puts the mark above the card, not inside it. It reads as
            "this is the thing you are signing in to" before "this is the form",
            which is the order an officer arriving cold needs. */}
          <div className="flex flex-col items-center text-center">
            <div className="rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-slate-900/[0.06]">
              <OrganisationLogos
                markClassName="h-14 w-16"
                sizes="64px"
                width={64}
                height={48}
              />
            </div>
            <h1 className="mt-6 text-[1.375rem] font-semibold tracking-tight text-slate-900">
              TSC Provincial Matters
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">
              Case management for the Kenya Teachers Service Commission
            </p>
          </div>

          <div className="mt-7 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-12px_rgba(15,23,42,0.18)] sm:p-7">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Sign in
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Access is limited to officers of the Commission.
              </p>
            </div>

            {isOAuthConfigured ? (
              <div className="mt-6">
                <Button
                  className="h-11 w-full rounded-lg text-[0.9375rem]"
                  onClick={() => startLogin(next)}
                  disabled={busy}
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign in with the Commission account
                </Button>

                {/* The rule and the label, rather than a gap. Two ways in with
                  nothing between them read as one confusing field. */}
                <div className="my-6 flex items-center gap-3">
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    or
                  </span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
              </div>
            ) : null}

            <form
              onSubmit={submit}
              className={isOAuthConfigured ? "space-y-5" : "mt-6 space-y-5"}
            >
              <div className="space-y-2">
                <Label
                  htmlFor="username"
                  className="text-[0.8125rem] text-slate-700"
                >
                  Username
                </Label>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <Input
                    id="username"
                    name="username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    aria-invalid={error ? true : undefined}
                    className="h-11 rounded-lg border-slate-300 pl-9 text-[0.9375rem] shadow-none focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/25"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-[0.8125rem] text-slate-700"
                >
                  Password
                </Label>
                <div className="relative">
                  <KeyRound
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    aria-invalid={error ? true : undefined}
                    className="h-11 rounded-lg border-slate-300 pl-9 pr-11 text-[0.9375rem] shadow-none focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(current => !current)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {/* Material's filled error: a tonal block rather than a red border
                on the field. A rejection is a state of the form, not a
                decoration on it, and it is announced rather than only coloured. */}
              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-900"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                    aria-hidden
                  />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                className="h-11 w-full rounded-lg text-[0.9375rem]"
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          {/* Below the card, at the weight of a footnote. The Golden Rule is the
            principle the office works to, and an officer meets it before they
            have an account — but it is context, not an instruction, so it is
            set quietly rather than made the visual centre of the page. */}
          <footer className="mt-7 space-y-2.5 text-center">
            <p className="text-xs leading-5 text-slate-500">
              Access is logged. Every action taken on a matter is recorded
              against your name in the accountability trail.
            </p>
            <p className="flex items-start justify-center gap-1.5 text-xs leading-5 text-slate-400">
              <ShieldCheck
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <span>
                No matter is received unregistered, unassigned, or closed
                without a recorded outcome.
              </span>
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}

export default function Login() {
  // `useSearchParams` suspends during prerender, so the reading half is split
  // into a Suspense boundary to keep the page static-buildable.
  return (
    <Suspense fallback={<PageLoader label="Loading sign in" />}>
      <LoginForm />
    </Suspense>
  );
}
