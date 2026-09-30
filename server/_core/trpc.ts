import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { ROLE_LABELS, roleAtLeast, type Role } from '@shared/roles';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
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

/** Platform oversight: user accounts, global audit trail, all matters, stats. */
export const superAdminProcedure = t.procedure.use(requireRole("super_admin"));
