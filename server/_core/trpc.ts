import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { ROLE_LABELS, roleAtLeast, type Role } from "@shared/roles";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ENV } from "./env";
import type { TrpcContext } from "./context";

/**
 * The shape of a rejected input, as this API reports it.
 *
 * tRPC hands a validation failure the validator's own error object as the cause
 * and puts that object's `message` — for Zod, a JSON document listing every
 * issue with its origin, code, limit and path — into the error message. That
 * string is what every client sees in a toast. It is a debugging artefact, not
 * a sentence, and it names fields by their wire path rather than by the label
 * on the form.
 */
type InputIssue = { path?: unknown[]; message?: string };

function inputIssues(error: TRPCError): InputIssue[] {
  // Only a rejected input is restated. A refusal thrown by a guard ("…requires
  // Professional Assistant") is already written for a person, and rewriting it
  // here would be the one change in this file that could break a message other
  // code is matching on.
  if (error.code !== "BAD_REQUEST") return [];
  const cause = error.cause as { issues?: unknown } | undefined;
  if (!cause || !Array.isArray(cause.issues)) return [];
  return cause.issues as InputIssue[];
}

/**
 * What every client is allowed to be told.
 *
 * Two kinds of failure reach here, and they are treated differently on purpose.
 *
 * A **rejected input** is the officer's own doing and tRPC already knows what is
 * wrong with it, so the validator's report is restated as sentences and
 * published grouped by field. A form can put each message against the box that
 * caused it instead of printing all of them in one corner.
 *
 * An **unexpected failure** is nobody's doing and its message is the internals'
 * own: a duplicate-key error from the driver, a null dereference, the text of a
 * failed assertion. Those messages are written for a log, and shipping them to a
 * browser tells a caller about the shape of the database for no benefit to them.
 * In production the message becomes a fixed sentence and the detail goes to the
 * server log, where it is useful. In development it is passed through, because
 * the person looking at it is the developer who wants the stack.
 *
 * A **refusal** — a capability guard, a rule the manual imposes — is already
 * written for a person and is never rewritten.
 *
 * The grouped report is published as `zodError` — the key tRPC's own
 * documentation uses, and the one the forms read. Its shape is
 * `{ formErrors, fieldErrors }` whichever validator produced the issues, so
 * nothing here is specific to the version of Zod in use.
 *
 * Exported rather than inlined so it can be exercised on its own: through
 * `createCaller` the error is thrown before any response is shaped, so the only
 * way to test what a client actually receives is to call this directly.
 */
export function formatInputError({
  shape,
  error,
}: {
  shape: { message: string; code: number; data: Record<string, unknown> };
  error: TRPCError;
}): typeof shape {
  // An unexpected failure, in production. Logged here rather than swallowed,
  // because this formatter is the last place the original error is still whole.
  if (error.code === "INTERNAL_SERVER_ERROR" && ENV.isProduction) {
    console.error("[TRPC] Unhandled failure", error.cause ?? error);
    return {
      ...shape,
      message:
        "Something went wrong on the server. Nothing was changed — try again, and tell the platform administrator if it keeps happening.",
      data: { ...shape.data, stack: undefined },
    };
  }

  const issues = inputIssues(error);
  if (!issues.length) return shape;

  const fieldErrors: Record<string, string[]> = {};
  const sentences: string[] = [];
  for (const issue of issues) {
    const sentence = issue.message?.trim();
    if (sentence) sentences.push(sentence);
    const key = Array.isArray(issue.path) ? issue.path.join(".") : "";
    if (key && sentence) (fieldErrors[key] ??= []).push(sentence);
  }
  if (!sentences.length) return shape;

  return {
    ...shape,
    message: sentences.join(" "),
    data: { ...shape.data, zodError: { formErrors: [], fieldErrors } },
  };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // The cast is the one seam here: `DefaultErrorData` does not model the
  // grouped issues this adds, and the client reads them through the same cast.
  errorFormatter: formatInputError as never,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Guards a procedure behind a minimum role tier. Higher tiers inherit every
 * capability below them, so `admin` satisfies an `adminProcedure` check but a
 * `commissioner` does not.
 */
const requireRole = (minimum: Role) =>
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    if (!roleAtLeast(ctx.user.role, minimum)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${NOT_ADMIN_ERR_MSG} (requires ${ROLE_LABELS[minimum]})`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });

export const adminProcedure = t.procedure.use(requireRole("admin"));

/**
 * Platform oversight: user accounts, global audit trail, all matters, stats.
 *
 * Defined and exported, but the admin router does not use it: every route there
 * is guarded by `requireCapability("platform:users" | "platform:audit" |
 * "platform:stats")` instead, so the tier the capability belongs to is decided in
 * `shared/access.ts` alongside the navigation item rather than here. `routers.ts`
 * used to import this and never call it.
 */
export const superAdminProcedure = t.procedure.use(requireRole("super_admin"));
