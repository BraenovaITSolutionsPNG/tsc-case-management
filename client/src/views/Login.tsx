"use client";

import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  supabaseBuildFault,
} from "@/lib/supabase";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
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
} from "lucide-react";
import officeIllustration from "@assets/login-bg-img/added-img.webp";
import { LANDING_PATH } from "@shared/landing";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The sign-in screen.
 *
 * One way in: an email address and a password, checked by Supabase. The
 * credential goes from the browser to Supabase and no further — this deployment
 * never sees an officer's password, which is the whole reason the identity layer
 * moved off this application. The session Supabase returns is written to an
 * httpOnly cookie, so nothing in the interface holds a token either.
 *
 * There is no way to create an account from here, and no way to sign up for one.
 * Officers are registered by the platform administrator on the admin screen,
 * which is also where a role is assigned — the manual makes the office that
 * receives an application identifiable (§15), so an account cannot be
 * self-issued at the front door. Public signup is switched off on the Supabase
 * project for the same reason, so this form is the only door and it is a door
 * an officer is given the key to.
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

/**
 * How long the platform may take before the sign-in is re-checked.
 *
 * The safety net for the wait the button now carries on its own. It used to
 * reload the document, which is exactly the thing an officer should never see
 * happen after they have signed in: the overview paints, and is then torn down
 * and painted again. On a cold deployment the dashboard's aggregation can
 * outlast this, so the reload fired on perfectly healthy sign-ins and looked
 * like a fault in the platform rather than the thing it was.
 *
 * So nothing is reloaded. The session cookie was written before the navigation
 * was attempted, which means the only question worth asking is whether it is
 * still good — and `auth.me` answers it without leaving the page. A session that
 * verifies sends the redirect effect above on its way; one that does not brings
 * the button back with the officer's address still in it.
 */
const HANDOVER_FALLBACK_MS = 20_000;

const REMEMBER_KEY = "tsc-remembered-email";

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
 * Blue, on one hue ramp so nothing on the screen is fighting anything else.
 *
 * Four steps of blue carry the whole composition, each with a job:
 *
 * - `action` is the only interactive colour. Everything you can press is this
 *   exact blue, which is what lets a form on a large colour field still be
 *   scanned in one pass.
 * - `emphasis` is a step deeper, for the two words in the promise that carry
 *   the argument. Darker than the button on purpose: a highlight that out-shouts
 *   the call to action is a highlight in the wrong place.
 * - `wordmark` is deeper again. It is the one piece of type on the panel big
 *   enough to carry a colour on its own.
 * - The panel is the same hue at a few per cent, laid as a vertical wash so the
 *   foot of the screen sits fractionally cooler than its head.
 *
 * The greys are blue-biased rather than neutral. A true neutral grey next to a
 * blue panel reads as a different material — a photograph pasted onto a poster
 * — so the ink, the muted text and every hairline are the same hue at low
 * saturation.
 *
 * `muted` and `faint` are darker than a straight swap of the previous violet
 * steps would have given, and deliberately so. The violet they replace measured
 * 3.98:1 for `muted` on the panel and 2.67:1 for `faint` on the card, both under
 * the 4.5:1 that body text needs — the panel copy and the field placeholders
 * were the two least legible things on the screen and read as a styling choice
 * rather than a fault. Every pairing below is now at or above 4.5:1, and
 * `faint` clears 3:1, which is the bar for the placeholder it is used for.
 */
const PALETTE = {
  "--login-action": "#2563EB",
  "--login-action-hover": "#1D4ED8",
  "--login-action-ring": "rgba(37, 99, 235, 0.28)",
  "--login-action-ring-soft": "rgba(37, 99, 235, 0.45)",
  "--login-emphasis": "#1D4ED8",
  "--login-wordmark": "#1E3A8A",
  "--login-panel-top": "#EFF6FF",
  "--login-panel-bottom": "#DBEAFE",
  "--login-page": "#F8FAFC",
  "--login-card": "#FFFFFF",
  "--login-ink": "#0F172A",
  "--login-muted": "#52637D",
  "--login-faint": "#7C8CA3",
  "--login-line": "#D6DFEC",
  /** Multiplied over the illustration to pull it onto this hue ramp. */
  "--login-illustration-wash": "rgba(29, 78, 216, 0.30)",
  /** Lifted over the artwork so the card stays the focus rather than the room. */
  "--login-illustration-scrim": "rgba(248, 250, 252, 0.26)",
  "--login-card-shadow":
    "0 1px 2px rgba(15, 23, 42, 0.05), 0 28px 64px -30px rgba(30, 58, 138, 0.30)",
  "--login-fab-surface": "#E0E9F7",
  "--login-fab-edge": "#D8E2F2",
  "--login-fab-shadow": "0 10px 30px -12px rgba(30, 58, 138, 0.40)",
  "--login-note-surface": "#EFF4FB",
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
 * blue over the artwork, which keeps every line and shadow in it while
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
  const { isAuthenticated, logout } = useAuth();
  // For re-checking the session if the handover below does not land.
  const utils = trpc.useUtils();
  // Null unless the server refused a session the browser holds: an identity
  // with no register row, or an account that has been deactivated. Null for an
  // ordinary anonymous visitor, which is why this is a second query rather than
  // a variant of `auth.me` — most people reaching this screen have no session,
  // and the answer they need is the form.
  //
  // Not gated. It used to be `enabled: !isAuthenticated && !loading`, which was
  // a sequencing bug dressed as an optimisation: the gate could not open until
  // `auth.me` had resolved, so the two queries ran one strictly after the other
  // and cost two round trips where the `httpBatchLink` would have coalesced
  // them into one. It is prefetched into the hydrated cache by the `/login`
  // segment now, so this reads its answer from the cache and fetches nothing —
  // but when it does refetch, the two belong in the same tick rather than in
  // sequence, so the gate stays gone.
  const refusal = trpc.auth.refusal.useQuery().data;

  // An already-signed-in officer arriving here is sent on, to the overview.
  //
  // This is a *fallback*. The `/login` segment resolves the session on the
  // server and redirects before any HTML is sent, so by the time this screen
  // mounts there is normally no session to find and this effect does nothing.
  // It stays because the session can change under a page that is already open —
  // signing in on a second tab, or an administrator signing the officer out
  // mid-session — and there is nothing server-side that would notice. It is a
  // client redirect rather than a server one only because the segment has
  // already rendered by the time it would matter.
  useEffect(() => {
    if (isAuthenticated) router.replace(LANDING_PATH);
  }, [isAuthenticated, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Material's pattern: the field is obscured by default, and the officer can
  // look at what they typed without the page having to leave a password in plain
  // sight over their shoulder. State lives here rather than on the input so the
  // toggle is a real button, reachable by keyboard and announced.
  const [showPassword, setShowPassword] = useState(false);
  // Off by default, and not offered at all below. A public terminal on the
  // Provincial Matters office floor should not hold a session for the next
  // person who sits down at it, so remembering the address was a convenience
  // that cost more than it was worth. The password is never written anywhere
  // regardless of this setting.
  const [remember, setRemember] = useState(false);
  const [resetNote, setResetNote] = useState(false);
  // The refusal screen's one button, disabled while it runs so a second press
  // cannot start a second sign-out behind the first.
  const [signingOut, setSigningOut] = useState(false);
  // True once the credential has been accepted and the platform is on its way.
  // Drives the fallback below; the button's own `busy` state covers the wait.
  const [awaitingPlatform, setAwaitingPlatform] = useState(false);

  useEffect(() => {
    if (!awaitingPlatform) return;

    const recheck = setTimeout(() => {
      // The navigation has not committed. Ask the one question that decides it,
      // rather than reloading the page: a session that verifies is picked up by
      // the redirect effect above, and one that does not hands the button back.
      setBusy(false);
      void utils.auth.me.refetch();
    }, HANDOVER_FALLBACK_MS);

    return () => clearTimeout(recheck);
  }, [awaitingPlatform, utils]);
  // The remembered address is read after mount, never during the first render:
  // the server has no `localStorage`, so rendering from it there would produce
  // markup that disagrees with the client's and React would discard the lot.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      // Storage disabled or full. The field simply starts empty.
    }
  }, []);

  useEffect(() => {
    try {
      // Unticking clears what was remembered; an empty field writes nothing, so
      // opening the page never wipes an address before it has been read back.
      if (!remember) localStorage.removeItem(REMEMBER_KEY);
      else if (email) localStorage.setItem(REMEMBER_KEY, email);
    } catch {
      // A browser that refuses the write still signs in; it just forgets.
    }
  }, [remember, email]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        // One message for every rejection. Supabase's own text would tell an
        // officer whether the address exists, which is the answer an outsider
        // needs to enumerate the Commission's staff, and it saves nobody any
        // time: the fix is the same either way.
        //
        // Logged, though, which the screen text is not. "Email not confirmed"
        // and "Invalid login credentials" have completely different fixes and
        // the officer cannot get from one to the other without opening the
        // console, so at least the console should say which it was.
        console.warn("[Auth] sign-in rejected:", signInError.message);
        setError("That email address and password were not accepted.");
        setBusy(false);
        return;
      }

      // The session is now in the cookie, and the navigation to the platform is
      // a *client-side* one. A hard load was the older behaviour, chosen so the
      // server would resolve the session on the first paint — which the landing
      // screen still does, being a Server Component — but it bought that at the
      // cost of tearing the whole document down, and a push keeps this screen
      // mounted until the platform's first paint commits.
      //
      // `busy` is left true, on purpose, and this comment used to say the
      // opposite: that the wait was covered by drawing a *second* loader here —
      // a full-screen takeover over the form. That was the arrangement until it
      // was pointed out that one sign-in produced two loaders in a row, a
      // spinner in the button and then a takeover that replaced it. An officer
      // watching that sees a control that cannot decide whether it is working,
      // and the form they had just filled in disappearing at the moment it
      // started to matter.
      //
      // So there is now exactly one, and it is the one they already pressed: the
      // button stays disabled with its spinner turning for the whole wait, until
      // this screen unmounts because the overview has committed. The form stays
      // on screen throughout, which is worth more than the takeover was — they
      // can still see the address they signed in with.
      setAwaitingPlatform(true);
      router.push(LANDING_PATH);
    } catch (error) {
      // Logged before it is replaced by a generic sentence, because this branch
      // fires on anything thrown — including exceptions raised *after* Supabase
      // accepted the password, when the session cookie is being written. "The
      // sign-in service could not be reached" sends the reader to check their
      // network, and the network is usually fine: an extension blocking
      // *.supabase.co, or a browser refusing the cookie, throws here while the
      // credential was good.
      console.error("[Auth] sign-in threw:", error);
      setError(
        "The sign-in service could not be reached. Try again in a moment."
      );
      setBusy(false);
    } finally {
      // The password is dropped from component state whatever happened. A form
      // that keeps it after a rejection would leave it in memory for as long as
      // the page is open, which on a shared machine is a stored credential
      // nobody asked to store.
      setPassword("");
    }
  };

  // Only once a session is *known* to exist, never merely while the probe for
  // one is running.
  //
  // This was `loading || isAuthenticated`, and it was the reason the sign-in
  // felt slow: every anonymous visitor — which is nearly everyone who opens
  // this screen — had the whole form replaced by a full-screen branded loader
  // for the duration of the `auth.me` request, before a single keystroke was
  // possible. The form was made to wait on a question that cannot change the
  // answer for a person with no session, which is nearly all of them.
  //
  // It is now `isAuthenticated` alone, and the ordering that question implies
  // has been inverted twice over. The server already answered it before this
  // screen mounted — `app/login/page.tsx` reads the session cookie, redirects a
  // signed-in officer away, and ships this screen with the answer already in
  // the hydrated cache — so the common case renders the form immediately with
  // nothing fetched and nothing waited on. What is left of this branch is the
  // rare officer who signs in on a second tab while this page is open, and for
  // them the loader still covers the redirect.
  if (isAuthenticated) {
    return <PageLoader label="Checking your session" />;
  }

  // Signed in with Supabase, and refused by us.
  //
  // Reached because a correct password is not the same as being let in: the row
  // behind the session may not exist, may have been deactivated, or may not have
  // been reachable to find out. All three land here after `useAuth` redirects,
  // and without this they are shown a form that will not accept them.
  //
  // So nothing on this screen claims to know which of the three it is. The
  // refusal above is the one place that knows, and it is written per fault; a
  // fixed second paragraph asserting a cause is how the previous wording came
  // to tell a platform with no database that the officer's record was the
  // problem — an account the operator would then go and create, for an officer
  // who already had one.
  if (refusal) {
    return (
      // The palette is published on the page element rather than on the card,
      // for the same reason it is on the root element below: the page colour is
      // read from it by an ancestor of the card, and a palette declared inside
      // the card leaves the field the card sits on unpainted.
      <main
        className="flex min-h-screen items-center justify-center bg-[var(--login-page)] px-6"
        style={PALETTE as React.CSSProperties}
      >
        <div className="w-full max-w-md rounded-xl bg-[var(--login-card)] px-8 py-10 shadow-[var(--login-card-shadow)]">
          <h2 className="text-2xl font-bold text-[var(--login-ink)]">
            Signed in, but we cannot sign you in
          </h2>
          <p className="mt-4 text-[0.9375rem] leading-6 text-[var(--login-ink)]">
            {refusal}
          </p>
          <p className="mt-4 text-[13px] leading-6 text-[var(--login-muted)]">
            Your password was accepted — Supabase confirmed who you are. What
            happens next is not yours to fix: an administrator has to.
          </p>
          {/*
           * Both sign-outs, in that order, and the reason is not belt-and-braces.
           *
           * `auth.me` reads an httpOnly cookie this code cannot see, so the
           * browser's own sign-out cannot end the session the server resolves —
           * on its own it cleared this tab and returned the officer to this very
           * screen, having pressed the button. That is why the server's comes
           * first: it deletes every Supabase session cookie that arrived on the
           * request, by name, whether or not Supabase could be reached.
           *
           * The browser's then runs, because the server can only delete the
           * cookies it can see, and Supabase's client is the only party that
           * knows every name it may have written — including a chunk index added
           * by a library update. It is also the only party that clears
           * client-side storage. It is second, and wrapped, so that its throwing —
           * or the client's own build fault making `getSupabaseBrowserClient`
           * throw outright — cannot stop the half that works.
           *
           * The navigation is in a `finally` for the same reason. If the request
           * fails there is nothing to clear and no way forward from this screen,
           * but the form is still somewhere to retry from.
           */}
          <Button
            type="button"
            variant="outline"
            className="mt-8 w-full"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void logout()
                .catch(error => {
                  console.error("[Auth] sign-out failed:", error);
                })
                .then(() => {
                  try {
                    return getSupabaseBrowserClient().auth.signOut();
                  } catch (error) {
                    console.warn("[Auth] browser sign-out failed:", error);
                    return undefined;
                  }
                })
                .catch(error => {
                  console.warn("[Auth] browser sign-out failed:", error);
                })
                .finally(() => window.location.assign("/login"));
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </main>
    );
  }

  if (!isSupabaseConfigured) {
    // A build with no Supabase URL or anon key cannot sign anybody in, and the
    // form would fail on submit with nothing to explain why. Said here instead,
    // at the one screen the officer is guaranteed to reach.
    return (
      // Published on the page element for the same reason as on the refusal
      // screen above, and because this is a whole page rather than a state of
      // the form: the officer has no other screen to fall back to.
      <main
        className="flex min-h-screen items-center justify-center bg-[var(--login-page)] px-6"
        style={PALETTE as React.CSSProperties}
      >
        <div className="w-full max-w-md rounded-xl bg-[var(--login-card)] px-8 py-10 shadow-[var(--login-card-shadow)]">
          <h2 className="text-2xl font-bold text-[var(--login-ink)]">
            Sign-in unavailable
          </h2>
          <p className="mt-4 text-[0.9375rem] leading-6 text-[var(--login-muted)]">
            This deployment was built without sign-in configured. Tell the
            platform administrator — nothing is wrong with your account.
          </p>
          {/*
           * Which of the two it was, and what the value was. The paragraph
           * above is all an officer can be told, because it is the whole of what
           * the officer knows; it is not enough for whoever has to fix it, and
           * this page is the only evidence the build left — `/login` is
           * prerendered, so nothing at runtime will ever report back that the
           * bundle was compiled without these.
           *
           * Safe to show, and deliberately so. It describes the build, not the
           * reader: no request and no submitted account reaches this string, and
           * the one value it can print is already in the bundle. The anon key is
           * reported as present or absent and never printed.
           */}
          {supabaseBuildFault && (
            <p className="mt-4 rounded-lg bg-[var(--login-muted)]/10 px-4 py-3 font-mono text-[0.8125rem] leading-6 break-words text-[var(--login-muted)]">
              {supabaseBuildFault}
            </p>
          )}
        </div>
      </main>
    );
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

              <form onSubmit={submit} className="mt-8 space-y-0">
                <div>
                  <Label
                    htmlFor="email"
                    className="text-[0.9375rem] font-medium text-[var(--login-ink)]"
                  >
                    Email address
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    aria-invalid={error ? true : undefined}
                    placeholder="j.kumul@education.gov.pg"
                    className="mt-2.5 h-11 rounded-lg border-[var(--login-line)] bg-transparent px-4 text-base text-[var(--login-ink)] shadow-none placeholder:text-[var(--login-faint)] focus-visible:border-[var(--login-action)] focus-visible:ring-[3px] focus-visible:ring-[var(--login-action-ring)]"
                  />
                  <p className="mt-2.5 text-[0.9375rem] leading-6 text-[var(--login-muted)]">
                    The address the platform administrator registered for you.
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
                    Passwords are reset by the platform administrator, who can
                    issue you a reset link. Ask them, then set a new password
                    through it — they never need to know your current one.
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
                    Remember my email address
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

/**
 * The sign-in screen.
 *
 * No Suspense boundary and no reading half split off, which is what this used to
 * need: the screen read a `next` parameter out of the query string, and
 * `useSearchParams` suspends during prerender, so the half that read it had to be
 * behind a boundary to keep the page static-buildable. Every sign-in lands on the
 * overview now — see `LANDING_PATH` — so there is nothing in the query string to
 * read and the whole screen prerenders as one piece.
 */
export default function Login() {
  return <LoginForm />;
}
