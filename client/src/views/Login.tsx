"use client";

import { isOAuthConfigured, startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OrganisationLogos } from "@/components/OrganisationLogos";
import { PageLoader } from "@/components/BrandLoader";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
} from "lucide-react";
import officeIllustration from "@assets/login-bg-img/added-img.webp";
import Image from "next/image";
import Link from "next/link";
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
 * identifiable (§15), so an account cannot be self-issued at the front door.
 *
 * On presentation: the screen is one field of colour with a card laid across
 * the seam between the two halves. The brand panel runs to a diagonal edge, so
 * the card sits on the boundary rather than inside either side — the form reads
 * as the door into the office, and the office is visible on both sides of it.
 * The panel carries the marks, the wordmark and the promise; everything
 * actionable is on the card. The rings on the right and the marks in them are
 * decoration, so they are hidden from assistive technology rather than
 * described.
 *
 * The palette is this screen's own, declared once below and published to the
 * subtree as custom properties, so every colour on the page — the panel wash,
 * the accent, the greys, the four rings — is one edit rather than thirty. It is
 * deliberately not the application's: the rest of the platform is teal, and the
 * sign-in screen is the one surface a first-time officer ever sees, so it is
 * given a colour of its own instead of inheriting whatever the theme tokens
 * happen to be set to. Change PALETTE and the whole screen moves together.
 */

const REMEMBER_KEY = "tsc-remembered-username";

/**
 * The office this platform belongs to, as it is credited on screen.
 *
 * One constant because it appears twice — beside the card on a wide screen, and
 * under it on a narrow one — and the two are the same statement about the same
 * body. A sign-in screen that credits the Commission in one layout and the
 * country in the other is a sign-in screen nobody trusts with a password.
 */
const COPYRIGHT = "© PNG - Teachers Service Commission 2026";

/**
 * Plum, on one hue ramp so nothing on the screen is fighting anything else.
 *
 * Four steps of violet carry the whole composition, each with a job:
 *
 * - `action` is the only interactive colour. Everything you can press is this
 *   exact violet, which is what lets a form on a large colour field still be
 *   scanned in one pass.
 * - `emphasis` is a step deeper, for the two words in the promise that carry
 *   the argument. Darker than the button on purpose: a highlight that out-shouts
 *   the call to action is a highlight in the wrong place.
 * - `wordmark` is deeper again. It is the one piece of type on the panel big
 *   enough to carry a colour on its own.
 * - The panel is the same hue at four per cent, laid as a vertical wash so the
 *   foot of the screen sits fractionally warmer than its head.
 *
 * The greys are violet-biased rather than neutral. A true neutral grey next to
 * a violet panel reads as a different material — a photograph pasted onto a
 * poster — so the ink, the muted text and every hairline are the same hue at
 * low saturation.
 */
const PALETTE = {
  "--login-action": "#7C3AED",
  "--login-action-hover": "#6D28D9",
  "--login-action-ring": "rgba(124, 58, 237, 0.28)",
  "--login-action-ring-soft": "rgba(124, 58, 237, 0.45)",
  "--login-emphasis": "#6D28D9",
  "--login-wordmark": "#4C1D95",
  "--login-panel-top": "#F8F0F6",
  "--login-panel-bottom": "#E9D5E6",
  "--login-page": "#FAF8FC",
  "--login-card": "#FFFFFF",
  "--login-ink": "#1A1226",
  "--login-muted": "#6E6480",
  "--login-faint": "#A29BB0",
  "--login-line": "#DCD5E4",
  /** Multiplied over the illustration to pull it onto this hue ramp. */
  "--login-illustration-wash": "rgba(109, 40, 217, 0.30)",
  /** Lifted over the artwork so the card stays the focus rather than the room. */
  "--login-illustration-scrim": "rgba(250, 248, 252, 0.26)",
  "--login-card-shadow":
    "0 1px 2px rgba(26, 18, 38, 0.05), 0 28px 64px -30px rgba(76, 29, 149, 0.30)",
  "--login-fab-surface": "#EDE7F2",
  "--login-fab-edge": "#F4F0F7",
  "--login-fab-shadow": "0 10px 30px -12px rgba(76, 29, 149, 0.40)",
  "--login-note-surface": "#F6F2F9",
} as const;

function BrandPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "text-center" : "text-left"}>
      {/* The marks, then the wordmark, then a rule, then the promise. That order
          is deliberate: what this is, who it belongs to, and what it is for,
          in that order, before a single field is offered. Unframed, because a
          tile around each crest is a third box in a composition of two. */}
      <div className={compact ? "flex justify-center" : ""}>
        <OrganisationLogos
          framed={false}
          markClassName="h-14 w-auto"
          sizes="168px"
          width={75}
          height={56}
        />
      </div>

      <p
        className={`mt-4 text-[2.25rem] font-bold leading-none tracking-[-0.03em] text-[var(--login-ink)] ${
          compact ? "" : "sm:text-[2.5rem]"
        }`}
      >
        tsc<span className="text-[var(--login-wordmark)]">matters</span>
      </p>

      <div
        className={`mt-7 h-px bg-[var(--login-line)] ${compact ? "mx-auto max-w-[14rem]" : "max-w-[24rem]"}`}
        aria-hidden
      />

      <h1
        className={`mt-9 text-[2.25rem] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--login-ink)] sm:text-[2.5rem] ${
          compact ? "mt-7" : ""
        }`}
      >
        Welcome to TSC Matters
      </h1>
      <p className="mt-4 text-[1.75rem] font-normal leading-[1.2] tracking-[-0.02em] text-[var(--login-ink)] sm:text-[1.875rem]">
        Every teacher matter, accounted for.
        <br />
        Stay <span className="text-[var(--login-emphasis)]">on track</span>.
      </p>
    </div>
  );
}

/**
 * The illustration, bleeding off the right edge.
 *
 * It replaced a set of concentric rings, which held the right quarter of the
 * screen without saying anything. The picture says what the platform is: an
 * office, a boardroom, a case workflow on a wall. It is decoration, so it is
 * `aria-hidden` and carries no alt text — the words beside it already name the
 * office, and a description of a stock illustration is noise to a screen reader
 * and to anyone who can see it.
 *
 * Two overlays tie a stock illustration to this palette. The wash multiplies a
 * violet over the artwork, which keeps every line and shadow in it while
 * pulling the colour toward the panel; the fade dissolves the left edge into
 * the page, because a photograph that stops on a straight vertical line reads
 * as a pasted rectangle rather than as a field the card is sitting in.
 */
function Illustration() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-[54%] lg:block"
    >
      <Image
        src={officeIllustration}
        alt=""
        fill
        priority
        sizes="54vw"
        // The fade is on the picture, not a panel laid over it: masking the
        // image dissolves its left edge into the page, where covering it would
        // simply hide the quarter of the artwork the fade was meant to reveal.
        className="object-cover object-[42%_center] [mask-image:linear-gradient(to_right,transparent_0%,#000_38%)]"
      />
      <div className="absolute inset-0 bg-[var(--login-illustration-wash)] mix-blend-multiply" />
      <div className="absolute inset-0 bg-[var(--login-illustration-scrim)]" />
    </div>
  );
}

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
  // On by default, as the Commission's published design shows it. It stores the
  // username only — never the password — and the write is guarded below, so
  // ticking it costs nothing an officer cannot see and unticking it clears it.
  const [remember, setRemember] = useState(true);
  const [resetNote, setResetNote] = useState(false);

  // The remembered username is read after mount, never during the first render:
  // the server has no `localStorage`, so rendering from it there would produce
  // markup that disagrees with the client's and React would discard the lot.
  useEffect(() => {
    try {
      // The switch already starts on, so only the username needs restoring.
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) setUsername(saved);
    } catch {
      // Storage disabled or full. The field simply starts empty.
    }
  }, []);

  useEffect(() => {
    try {
      // Unticking clears what was remembered; an empty field writes nothing, so
      // opening the page never wipes a username before it has been read back.
      if (!remember) localStorage.removeItem(REMEMBER_KEY);
      else if (username) localStorage.setItem(REMEMBER_KEY, username);
    } catch {
      // A browser that refuses the write still signs in; it just forgets.
    }
  }, [remember, username]);

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
    <main
      className="relative min-h-screen overflow-hidden bg-[var(--login-page)]"
      // Every colour below is read from these, so the screen is re-skinned by
      // editing one object rather than by hunting hex values through the JSX.
      style={PALETTE as React.CSSProperties}
    >
      {/* The panel. On a wide screen it is a full-height field of colour cut off
          by a diagonal, so the card below lands on the seam; below `lg` it
          becomes a band behind the compact brand block. Purely a backdrop — the
          marks and the wordmark sit on top of it, so it carries no information
          of its own and is not announced. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] lg:inset-0 lg:h-auto lg:[clip-path:polygon(0_0,69.1%_0,54.7%_100%,0_100%)]"
        style={{
          background:
            "linear-gradient(to bottom, var(--login-panel-top), var(--login-panel-bottom))",
        }}
      />

      <Illustration />

      {/* Two columns on a wide screen, one on a narrow one. The brand block
          leads on a phone — the officer knows what they opened before they are
          asked to type — and sits beside the card on a desktop.

          The row is deliberately not centred. The composition is left-weighted:
          the panel, the wordmark and the card all sit in the left three quarters
          and the right quarter is left empty for the rings, so a centred
          container would push the whole thing away from the edge it is composed
          against. The brand column is capped rather than fluid for the same
          reason — a promise set in a column that stretches with the window
          stops being a line of type and starts being a paragraph. */}
      <div className="relative flex min-h-screen w-full max-w-[76rem] flex-col px-6 py-12 sm:px-10 lg:flex-row lg:items-center lg:gap-12 lg:px-16 lg:py-16 xl:gap-16">
        <div className="flex flex-1 flex-col lg:max-w-[34rem] lg:self-stretch">
          <div className="flex flex-1 flex-col justify-center">
            <div className="lg:hidden">
              <BrandPanel compact />
            </div>
            <div className="hidden lg:block">
              <BrandPanel />
            </div>
          </div>

          {/* The copyright sits on the panel rather than in a footer strip, so
              it stays attached to the office it names when the card changes
              height — and at the foot of the panel, not floating at the end of
              whatever the brand block happens to measure. */}
          <p className="hidden pt-16 text-[0.9375rem] text-[var(--login-muted)] lg:block">
            {COPYRIGHT}
          </p>
        </div>

        {/* The card is set a little below centre, as in the reference: the brand
            block above it is the taller mass, and a card centred on the
            viewport would sit level with the middle of the promise rather than
            with its last line. */}
        <div className="flex flex-1 items-center lg:w-[30rem] lg:flex-none lg:translate-y-12">
          <div className="relative w-full">
            <div className="w-full rounded-xl bg-[var(--login-card)] px-9 pb-9 pt-11 shadow-[var(--login-card-shadow)]">
              <h2 className="text-[2.5rem] font-bold leading-none tracking-[-0.02em] text-[var(--login-ink)]">
                Sign in
              </h2>

              {isOAuthConfigured ? (
                <div className="mt-7">
                  <Button
                    className="h-11 w-full rounded-lg bg-[var(--login-action)] text-[0.9375rem] font-medium text-white hover:bg-[var(--login-action-hover)]"
                    onClick={() => startLogin(next)}
                    disabled={busy}
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign in with the Commission account
                  </Button>

                  {/* The rule and the label, rather than a gap. Two ways in with
                  nothing between them read as one confusing field. */}
                  <div className="my-6 flex items-center gap-3">
                    <span className="h-px flex-1 bg-[var(--login-line)]" />
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--login-faint)]">
                      or
                    </span>
                    <span className="h-px flex-1 bg-[var(--login-line)]" />
                  </div>
                </div>
              ) : null}

              <form
                onSubmit={submit}
                className={isOAuthConfigured ? "space-y-5" : "mt-8 space-y-0"}
              >
                <div>
                  <Label
                    htmlFor="username"
                    className="text-[0.9375rem] font-medium text-[var(--login-ink)]"
                  >
                    Username
                  </Label>
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
                    placeholder="j.kumul"
                    className="mt-2.5 h-11 rounded-lg border-[var(--login-line)] bg-transparent px-4 text-base text-[var(--login-ink)] shadow-none placeholder:text-[var(--login-faint)] focus-visible:border-[var(--login-action)] focus-visible:ring-[3px] focus-visible:ring-[var(--login-action-ring)]"
                  />
                  <p className="mt-2.5 text-[0.9375rem] leading-6 text-[var(--login-muted)]">
                    The username the platform administrator issued you.
                  </p>
                </div>

                <div className="mt-3">
                  <Label
                    htmlFor="password"
                    className="text-[0.9375rem] font-medium text-[var(--login-ink)]"
                  >
                    Password
                  </Label>
                  <div className="relative mt-2.5">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      aria-invalid={error ? true : undefined}
                      placeholder="Enter your password"
                      className="h-11 rounded-lg border-[var(--login-line)] bg-transparent px-4 pr-12 text-base text-[var(--login-ink)] shadow-none placeholder:text-[var(--login-faint)] focus-visible:border-[var(--login-action)] focus-visible:ring-[3px] focus-visible:ring-[var(--login-action-ring)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(current => !current)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      aria-pressed={showPassword}
                      className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--login-faint)] transition-colors hover:bg-[var(--login-note-surface)] hover:text-[var(--login-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-action-ring-soft)]"
                    >
                      {showPassword ? (
                        <EyeOff
                          className="h-[1.125rem] w-[1.125rem]"
                          aria-hidden
                        />
                      ) : (
                        <Eye
                          className="h-[1.125rem] w-[1.125rem]"
                          aria-hidden
                        />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setResetNote(current => !current)}
                    aria-expanded={resetNote}
                    className="rounded text-[0.9375rem] text-[var(--login-muted)] underline-offset-4 transition-colors hover:text-[var(--login-action)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-action-ring-soft)]"
                  >
                    Forgot password?
                  </button>
                </div>

                {/* There is no self-service reset: an officer's account is
                  created and re-keyed by the platform administrator, so the
                  link answers the question rather than opening a form that
                  would be rejected at the far end anyway. */}
                {resetNote ? (
                  <p className="mt-3 rounded-lg bg-[var(--login-note-surface)] px-3.5 py-3 text-[0.9375rem] leading-6 text-[var(--login-muted)]">
                    Passwords are reset by the platform administrator. Ask them
                    to re-issue yours, then sign in here.
                  </p>
                ) : null}

                <div className="mt-8 flex items-center gap-3">
                  <Switch
                    id="remember"
                    checked={remember}
                    onCheckedChange={setRemember}
                    className="h-[1.375rem] w-[2.625rem] data-[state=checked]:bg-[var(--login-action)] [&>span]:size-[1.125rem]"
                  />
                  <Label
                    htmlFor="remember"
                    className="cursor-pointer text-[0.9375rem] font-medium text-[var(--login-muted)]"
                  >
                    Remember sign in details
                  </Label>
                </div>

                {/* Material's filled error: a tonal block rather than a red border
                on the field. A rejection is a state of the form, not a
                decoration on it, and it is announced rather than only coloured. */}
                {error ? (
                  <div
                    role="alert"
                    className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-5 text-red-900"
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
                  className="mt-12 h-11 w-full rounded-lg bg-[var(--login-action)] text-[0.9375rem] font-medium text-white hover:bg-[var(--login-action-hover)] focus-visible:ring-[var(--login-action-ring-soft)]"
                  disabled={busy}
                >
                  {/* The arrow follows the words, so the pair reads as a
                    direction rather than as an icon button with a caption. The
                    spinner leads, because while it is turning the label is a
                    status and not an instruction. */}
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="ml-2.5 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </div>

            {/* The floating round link. It hangs off the card's bottom-right
                corner, so it reads as belonging to the form without competing
                with the sign-in button for the same glance. It leads to the
                officer's guide, which is the one thing an officer can need
                before they have an account to need anything with. */}
            <Link
              href="/guide"
              aria-label="Read the officer's guide"
              title="Officer's guide"
              className="absolute -bottom-[3.8rem] -right-[2.9rem] hidden h-[3.5rem] w-[3.5rem] items-center justify-center rounded-full border border-[var(--login-fab-edge)] bg-[var(--login-fab-surface)] text-[var(--login-action)] shadow-[var(--login-fab-shadow)] transition-transform hover:scale-105 hover:text-[var(--login-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--login-action)] focus-visible:ring-offset-2 lg:flex"
            >
              <BookOpen className="h-6 w-6" aria-hidden />
            </Link>
          </div>
        </div>
      </div>

      <p className="relative mt-auto px-6 pb-8 text-center text-[0.9375rem] text-[var(--login-muted)] lg:hidden">
        {COPYRIGHT}
      </p>
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
