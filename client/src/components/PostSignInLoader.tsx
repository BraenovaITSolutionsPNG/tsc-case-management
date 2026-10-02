"use client";

import { PageLoader } from "@/components/BrandLoader";
import { peekPostSignIn, onPostSignIn } from "@/lib/postSignIn";
import { useEffect, useState } from "react";

/**
 * Chooses between the two full-screen loaders App Router can show.
 *
 * The ordinary case is `PageLoader`, and it is the right answer for every
 * navigation inside the platform. It is the wrong answer for the one navigation
 * that follows a sign-in: the officer has just proved who they are, and being
 * shown a generic "Checking your session" for the seconds the dashboard takes to
 * arrive undoes the moment the sign-in screen just spent making. So where a
 * sign-in is waiting, this draws the branded screen instead.
 *
 * It *peeks* at the note rather than consuming it. App Router renders this
 * before the root layout's gate has mounted, so this is the first reader; the
 * gate is the last and takes it. A version that consumed here would leave the
 * gate with nothing to hand over from and put a skeleton on screen at the exact
 * moment the logo leaves.
 *
 * The state is deliberately `null` until mounted. Rendering the branded screen
 * on the server would be a lie — the note lives in the browser, and the server
 * cannot know — and rendering the ordinary one first would be the flash this
 * component exists to prevent. So it paints nothing at all for the one tick it
 * takes to find out, which is behind the gate's screen anyway on the navigation
 * that matters.
 */
export function PostSignInLoader() {
  const [pending, setPending] = useState<boolean | null>(null);

  useEffect(() => {
    if (peekPostSignIn()) setPending(true);
    // The event covers a sign-in completed while this component is already
    // mounted, which is the ordinary case: the officer is already looking at the
    // sign-in screen when the credential is accepted.
    return onPostSignIn(() => setPending(true));
  }, []);

  if (pending === null) return null;
  if (pending) return <BrandedStandIn />;

  return <PageLoader />;
}

/**
 * A quiet placeholder, not a second branded screen.
 *
 * The root layout's gate is already drawing the real one at this point, on top.
 * This exists only so the fallback has *something* to occupy the viewport with
 * before the gate has mounted, which on the navigation that matters is a
 * fraction of a second. Two branded screens stacked on each other would restart
 * the mark's animation at the moment it is assembling, which is worse than a
 * plain field of the platform's own colour.
 */
function BrandedStandIn() {
  return <div className="min-h-screen bg-[#07558f]" aria-hidden />;
}
