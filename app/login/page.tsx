"use client";

import Login from "@/views/Login";

/**
 * Route segment for /Login.
 *
 * The screen itself is a client component: it reads through the tRPC query
 * hooks, so it needs the providers mounted in the root layout. App Router owns
 * the URL; this file is only the segment that binds the two together.
 */
export default function Page() {
  return <Login />;
}
