/**
 * Where every sign-in lands.
 *
 * One place, because it is now the answer to a question asked in five different
 * files — the sign-in screen, the server-side guard, the layout's redirect, the
 * 401 handler — and five copies of a route is five places for them to disagree
 * about which page the platform opens on.
 *
 * The overview rather than wherever the officer was. That is the opposite of what
 * this used to do, and deliberately so: it carried the requested path through the
 * sign-in flow as a `next` parameter, so an officer interrupted mid-matter came
 * back to that matter.
 *
 * Returning them there was wrong in a way that only showed up later. The path is
 * captured when the session lapses, and a matter can be closed, reassigned or
 * moved out from under it in the time between the expiry and the officer signing
 * in again — at which point they land on a matter they can no longer open, or on
 * one that is no longer what they left. The overview is the one page every role
 * can reach and it always answers the same question: what is waiting for me.
 *
 * A matter is one click away in the register, and the register is one click from
 * the overview. What was bought by the old behaviour was a slightly shorter path
 * back, at the cost of landing somewhere unpredictable.
 */
export const LANDING_PATH = "/";
