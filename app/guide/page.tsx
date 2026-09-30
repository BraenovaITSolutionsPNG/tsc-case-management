import Guide from "@/views/Guide";

/**
 * Route segment for /Guide.
 *
 * Deliberately unguarded. The sign-in screen's floating button points here, and
 * an officer who cannot sign in yet is exactly the officer who needs to read it
 * — a guide behind the session check would be a page that cannot be reached from
 * the one place it is offered.
 */

export default function Page() {
  return <Guide />;
}
