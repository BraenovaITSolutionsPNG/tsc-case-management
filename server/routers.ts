import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import {
  AUDIT_PAGE_SIZE,
  OVERSIGHT_PAGE_SIZE,
  REGISTER_PAGE_SIZE,
} from "@shared/pagination";
import {
  CASE_BRIEF_CONDITIONAL_KEYS,
  CASE_BRIEF_FIELDS,
  CASE_BRIEF_MIN_LENGTH,
  briefNeedsDecision,
  CASEFILE_MAX_BYTES,
  CASEFILE_MIME_TYPES,
  DOCUMENT_CLASSES,
  DOCUMENT_CLASS_KEYS,
  ESCALATION_LEVELS,
  MAX_ESCALATION_LEVEL,
  REFERRAL_CRITERIA,
  caseBriefFieldError,
  checkGoldenRule,
  escalationLabel,
  isLegalReferral,
  type CasefileMimeType,
} from "@shared/delegation";
import { can, refusalFor, type Capability } from "@shared/access";
import {
  dateField,
  emailAddress,
  optionalText,
  pageBounds,
  recordId,
  requiredText,
  searchTerm,
} from "@shared/validation";
import { matterTypeValues, provinceValues } from "@shared/matters";
import { ROLE_VALUES, type Role } from "@shared/roles";
import { STATUS_VALUES } from "@shared/statuses";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  issuePasswordReset,
  provisionUser,
  removeIdentity,
  setPasswordDirectly,
} from "./auth/provisioning";
import { storageDelete, storagePut } from "./storage";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
  superAdminProcedure,
} from "./_core/trpc";
import {
  addCaseDocument,
  addCaseEvent,
  clearAuthLink,
  clearUserAvatar,
  createCase,
  createReferral,
  deleteUser,
  deleteCaseDocument,
  getAuthUserIdForUser,
  getCaseById,
  getDashboardData,
  getGoldenRuleCompliance,
  getMonthlyReport,
  getOfficerPerformance,
  getQuarterlyReport,
  getSystemStats,
  getUserReferences,
  getWeeklyBrief,
  listAuditEventTypes,
  listAuditLog,
  listCases,
  listCasesPage,
  findUserIdByName,
  listOfficers,
  listProvinces,
  listQuarters,
  listUsers,
  recordReferralResponse,
  setUserActive,
  setUserAvatar,
  setUserRole,
  setUserUsername,
  summariseCases,
  updateCase,
  usernameTaken,
} from "./db";

const statusEnum = z.enum(STATUS_VALUES);
// Both classifications are read from shared/matters so the validator accepts
// exactly what the interface offers and the database enum stores.
const matterTypeEnum = z.enum(matterTypeValues);
const provinceEnum = z.enum(provinceValues);
const REFERRAL_CRITERION_KEYS = REFERRAL_CRITERIA.map(item => item.key) as [
  string,
  ...string[],
];
const roleEnum = z.enum(ROLE_VALUES);

/**
 * One section of a §12C case brief.
 *
 * The message is the same sentence the brief form shows against the offending
 * box, so a rejection and a client-side warning read identically. Without it
 * the officer gets the schema's default — "Too small: expected string to have
 * >=4 characters" — which names neither the section nor what to do about it.
 *
 * The message is chosen per failure rather than fixed, because "this section is
 * required" and "write at least four characters" are different instructions for
 * two different mistakes. A single fixed message would say the second to an
 * officer who had left the box empty, and the form's own check would say the
 * first to the same officer — the same mistake worded two ways depending on
 * which side happened to catch it.
 */
function briefSection(key: string) {
  const field = CASE_BRIEF_FIELDS.find(item => item.key === key) ?? {
    key,
    label: "This section",
  };
  return z
    .string()
    .trim()
    .min(CASE_BRIEF_MIN_LENGTH, {
      // `error` rather than the deprecated `message`, because only `error` takes
      // a function — and the function is the point: it is what lets the message
      // depend on whether the officer left the box empty or wrote too little.
      error: issue =>
        caseBriefFieldError(
          field,
          typeof issue.input === "string" ? issue.input : ""
        ) ?? `${field.label} is required.`,
    });
}

/**
 * A brief section that only has to be filled in when the matter is being put to
 * the Director for a decision.
 *
 * §12C asks a brief to state what the Director needs to decide and what the
 * province proposes. §12B's flag is what says whether there is such a thing to
 * decide, so the requirement follows the flag: a matter the province is simply
 * pursuing is not made to carry two invented sections, and the moment it is
 * flagged the same two sections become mandatory again.
 *
 * The key is not used here — the length floor for these two is applied in the
 * refinement below, once the flag in the same payload is known.
 */
function conditionalBriefSection() {
  return z.string().trim();
}

/**
 * Profile image constraints. An avatar is rendered at most 96px square, so the
 * ceiling is well above what is useful and exists to stop someone using the
 * upload as bulk storage. The type is an allowlist rather than a denylist: the
 * browser sends a Content-Type the client chose, and a denylist is bypassed by
 * renaming a file to `.jpg`.
 */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The stored extension follows the sniffed type, never the filename. */
const AVATAR_EXTENSIONS: Record<(typeof AVATAR_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * §11 case file.
 *
 * The accepted types and the size ceiling live in shared/delegation, not here.
 * The client needs the same list to narrow `File.type` before it sends, and a
 * list that exists twice is a list that will disagree: the client would offer
 * the picker for a format the server then refuses, or refuse one it would
 * accept, and either way the officer is told the case file is broken when it
 * is only the two halves that have drifted.
 */
const DOCUMENT_TYPES = CASEFILE_MIME_TYPES;

const DOCUMENT_EXTENSIONS: Record<CasefileMimeType, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

/** Shown in the refusal, so an officer is told what to send instead. */
const DOCUMENT_TYPE_LABELS = ["PDF", "PNG", "JPEG", "WebP", "Word", "Excel"];

/**
 * 10MB, against a 32MB max_allowed_packet.
 *
 * The bytes travel as base64 inside a JSON body, which inflates by a third -
 * 10MB becomes about 13.3MB - so the server limit has to be comfortably above
 * the encoded size or the driver rejects the packet with an error that says
 * nothing about which upload was too large. This is comfortably under 32MB with
 * room for the envelope.
 *
 * The alternative - a presigned PUT straight to the browser - would lift the
 * ceiling, but the local-disk development fallback cannot issue one, so the
 * upload would work in production and fail in development. One code path is
 * worth more here than an unconstrained ceiling.
 */
const DOCUMENT_MAX_BYTES = CASEFILE_MAX_BYTES;

/**
 * Magic numbers for the accepted document types.
 *
 * DOCX and XLSX are ZIP containers, so `%PK` alone cannot separate them from
 * each other or from any other zip - the file's internal part names are what
 * distinguish them, and those are read from the tail of the central directory.
 * A caller that renames a spreadsheet to `.docx` is refused, which matters
 * because the stored extension is derived from this.
 */
const DOCUMENT_SIGNATURES: {
  mimeType: CasefileMimeType;
  test: (bytes: Buffer) => boolean;
}[] = [
  {
    mimeType: "application/pdf",
    test: b => b.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  {
    mimeType: "image/png",
    test: b =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: "image/jpeg",
    test: b =>
      b.length > 3 &&
      b[0] === 0xff &&
      b[1] === 0xd8 &&
      b[2] === 0xff &&
      b[b.length - 2] === 0xff &&
      b[b.length - 1] === 0xd9,
  },
  {
    mimeType: "image/webp",
    test: b =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    mimeType: "application/msword",
    test: b =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  },
  {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    test: b => isOpenXml(b, "word"),
  },
  {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    test: b => isOpenXml(b, "xl"),
  },
  {
    mimeType: "application/vnd.ms-excel",
    test: b =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  },
  { mimeType: "text/plain", test: b => isProbablyText(b) },
];

/** True when the buffer is a zip whose entries are the named OOXML part. */
function isOpenXml(bytes: Buffer, folder: "word" | "xl"): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  // The part name appears in the central directory filenames near the end. Only
  // the tail is searched, so a document that merely mentions the string in its
  // body is not mistaken for one.
  const tail = bytes
    .subarray(Math.max(0, bytes.length - 8192))
    .toString("latin1");
  return tail.includes(`${folder}/`) || tail.includes(`/${folder}/`);
}

/**
 * Whether the bytes read as text. Deliberately strict: a NUL byte or a high
 * ratio of non-printable characters means this is a binary that was not
 * otherwise recognised, and it should be refused rather than stored as a `.txt`
 * that the browser then renders as garbage.
 */
function isProbablyText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 1024);
  let suspicious = 0;
  // Indexed rather than iterated: a Buffer is a Uint8Array, and iterating one
  // needs a downlevel target this project does not compile to.
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i];
    if (byte === 0) return false;
    // Tab, newline, carriage return are legitimate in a text file.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return sample.length === 0 || suspicious / sample.length < 0.1;
}

/**
 * The document type the bytes actually are, or null. The type the client
 * declared has to agree with this, so nothing is ever stored under a content
 * type that misdescribes it.
 */
function sniffDocument(buffer: Buffer): CasefileMimeType | null {
  return (
    DOCUMENT_SIGNATURES.find(signature => signature.test(buffer))?.mimeType ??
    null
  );
}

/** Magic numbers for the three accepted formats. */
const IMAGE_SIGNATURES: {
  mimeType: (typeof AVATAR_TYPES)[number];
  test: (bytes: Buffer) => boolean;
}[] = [
  // PNG: \x89 P N G \r \n \x1a \n
  {
    mimeType: "image/png",
    test: b =>
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  // JPEG: FFD8FF, then a further FFD9 at the very end for the EOI marker.
  {
    mimeType: "image/jpeg",
    test: b =>
      b.length > 3 &&
      b[0] === 0xff &&
      b[1] === 0xd8 &&
      b[2] === 0xff &&
      b[b.length - 2] === 0xff &&
      b[b.length - 1] === 0xd9,
  },
  // WebP: "RIFF" .... "WEBP"
  {
    mimeType: "image/webp",
    test: b =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/**
 * The accepted format the bytes actually are, or null. The type the client
 * declared has to agree with this - a mismatch is rejected rather than believed,
 * so the object is never stored under a content type that lies about its
 * contents.
 */
function sniffImage(buffer: Buffer): (typeof AVATAR_TYPES)[number] | null {
  return (
    IMAGE_SIGNATURES.find(signature => signature.test(buffer))?.mimeType ?? null
  );
}

const nameOf = (user: { name: string | null; email: string | null }) =>
  user.name || user.email || "TSC officer";

/**
 * Guards a procedure behind a capability rather than a role tier, so the route
 * and the navigation item that links to it are driven by the same list in
 * shared/access.ts. A role that can see an option can also call the route.
 */
const requireCapability = (capability: Capability) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!can(ctx.user.role, capability)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: refusalFor(ctx.user.role, capability),
      });
    }
    return next();
  });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    /**
     * Why `auth.me` answered null, when there was a session and it was refused.
     *
     * A separate procedure rather than a change to `auth.me`'s shape, because
     * `me` is read in eight places and a server-side prefetch, and all of them
     * want the officer or nothing. This one is read only by the sign-in screen,
     * and only when `me` is null.
     *
     * It is for the officer who signed in correctly and was then refused —
     * an identity with no register row, or an account that has been deactivated.
     * Without it they are handed a sign-in form that will not accept them, which
     * reads as a wrong password: the one conclusion the evidence does not
     * support, and the one they will act on.
     */
    refusal: publicProcedure.query(opts => opts.ctx.refusal ?? null),
    /**
     * Upload the signed-in officer's own profile image.
     *
     * The image arrives as base64 rather than as a multipart body: tRPC's
     * JSON transport is what the rest of the API uses, and this keeps the
     * upload on the same path instead of adding a second one. The cost is a
     * third of the payload in JSON escaping, which the size ceiling covers.
     *
     * The bytes are validated before the object store is touched, and the store
     * is the same Forge/S3 path the case file uses.
     */
    uploadAvatar: protectedProcedure
      .input(
        z.object({
          /** Base64 payload, without a data: URL prefix. */
          data: z.string(),
          mimeType: z.enum(AVATAR_TYPES, {
            error: "Choose a PNG, JPEG or WebP image.",
          }),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.data, "base64");

        // A malformed base64 string decodes to fewer bytes than it appears to,
        // so the length is re-checked after decoding rather than trusted from
        // the encoded form.
        if (buffer.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That file could not be read as an image.",
          });
        }
        if (buffer.length > AVATAR_MAX_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Profile images must be 2 MB or smaller. That one is ${(buffer.length / 1024 / 1024).toFixed(1)} MB.`,
          });
        }
        // The declared type is only half the story: the bytes have to carry a
        // matching image signature, so a renamed script cannot be stored and
        // later served back under an image content type.
        const actual = sniffImage(buffer);
        if (actual !== input.mimeType) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only PNG, JPEG or WebP images are accepted.",
          });
        }

        const extension = AVATAR_EXTENSIONS[actual];
        try {
          const { key } = await storagePut(
            // Keyed by user id, not by name: the name changes and the key must
            // not, or every rename would orphan the object already in the store.
            `avatars/${ctx.user.id}.${extension}`,
            buffer,
            actual
          );
          return setUserAvatar(ctx.user.id, key);
        } catch (cause) {
          // A storage failure is a server-side condition, not something the
          // officer did wrong. It is reported as such and logged in full on the
          // server, so a configured-and-then-unreachable store does not read as
          // "your image was rejected".
          console.error("[Auth] avatar upload failed:", cause);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "The image could not be stored. Try again in a moment, or contact the platform administrator.",
          });
        }
      }),
    removeAvatar: protectedProcedure.mutation(async ({ ctx }) => {
      return clearUserAvatar(ctx.user.id);
    }),
    /**
     * Sign out.
     *
     * Clears the Supabase session cookies rather than one application cookie of
     * our own, so the server-side Supabase client stops finding a session on the
     * next request. @supabase/ssr knows the cookie names, which include the
     * project ref and a chunk index when a session is large enough to be split;
     * naming them here would be correct only until that happened.
     *
     * Public, not protected: signing out has to work when there is no valid
     * session, which is exactly when a user is most likely to press the button.
     */
    logout: publicProcedure.mutation(async ({ ctx }) => {
      try {
        const { createServerClient } = await import("./_core/supabaseAuth");
        const supabase = await createServerClient();
        await supabase.auth.signOut();
      } catch (error) {
        // Cookies are cleared below regardless. A sign-out that fails because
        // Supabase is unreachable must still end with a browser that has no
        // usable session, or the officer cannot leave.
        console.warn("[Auth] Supabase sign-out failed:", String(error));
      }
      // Explicit removal of the session cookies as well, in case the client
      // above could not run. Best effort: a cookie that was never set is not an
      // error to report.
      ctx.res.clearCookie(COOKIE_NAME, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      return { success: true } as const;
    }),
  }),
  caseManagement: router({
    dashboard: protectedProcedure.query(() => getDashboardData()),
    list: protectedProcedure
      .input(
        z
          .object({
            search: searchTerm(),
            status: statusEnum.optional(),
            matterType: matterTypeEnum.optional(),
            province: z.string().trim().max(80).optional(),
            overdueOnly: z.boolean().optional(),
            // Paging. Bounded at both ends: the ceiling is not a guess about how
            // large a page may be, it is what stops one request asking for the
            // province and putting back what paging was introduced to avoid.
            ...pageBounds(REGISTER_PAGE_SIZE),
          })
          .optional()
      )
      .query(({ input }) =>
        listCasesPage(input, {
          limit: input?.limit ?? REGISTER_PAGE_SIZE,
          offset: input?.offset ?? 0,
        })
      ),
    /**
     * The figures above the register, counted over every matter in the province
     * rather than over the filtered page. Separate from `list` on purpose: the
     * two answer different questions, and a filter that hid an overdue province
     * must not be able to make the register report that nothing is overdue.
     */
    summary: protectedProcedure.query(() => summariseCases()),
    getById: protectedProcedure
      .input(z.object({ id: recordId() }))
      .query(({ input }) => getCaseById(input.id)),
    create: requireCapability("matter:register")
      .input(
        z.object({
          dateReceived: dateField(),
          province: provinceEnum,
          teacherName: requiredText("Teacher's name", { min: 2, max: 160 }),
          employeeReference: optionalText("Employee reference", {
            max: 60,
          }).optional(),
          matterType: matterTypeEnum,
          matterSummary: requiredText("Summary of the matter", {
            min: 8,
            max: 4000,
          }),
          assignedOfficerName: optionalText("Assigned officer", {
            max: 160,
          }).optional(),
          actionRequired: optionalText("Action required", {
            max: 2000,
          }).optional(),
          dueDate: dateField().optional(),
          priority: z
            .enum(["normal", "urgent"], {
              error: "Choose normal or urgent.",
            })
            .default("normal"),
        })
      )
      .mutation(async ({ ctx, input }) =>
        createCase({
          ...input,
          // The name goes on the file; the id is what the accountability trail
          // counts, so a matter is answerable to an account from the moment it is
          // registered rather than only after its first reassignment.
          assignedOfficerId: input.assignedOfficerName
            ? await findUserIdByName(input.assignedOfficerName)
            : null,
          createdById: ctx.user.id,
          createdByName: nameOf(ctx.user),
          receivedByName: nameOf(ctx.user),
          status: "NEW",
        })
      ),
    update: requireCapability("matter:update")
      .input(
        z.object({
          id: recordId(),
          status: statusEnum.optional(),
          // Nullable, not merely optional: `undefined` means "leave this field
          // alone" and is stripped before the write, so an officer who clears a
          // field in the interface would be told the matter was updated while
          // nothing changed. `null` is the explicit instruction to clear it.
          assignedOfficerName: optionalText("Assigned officer", { max: 160 })
            .nullable()
            .optional(),
          sectionReferred: optionalText("Section referred to", { max: 160 })
            .nullable()
            .optional(),
          actionRequired: optionalText("Action required", { max: 2000 })
            .nullable()
            .optional(),
          dueDate: dateField().nullable().optional(),
          outcome: optionalText("Outcome", { max: 2000 }).nullable().optional(),
          dateClosed: dateField().nullable().optional(),
          priority: z
            .enum(["normal", "urgent"], { error: "Choose normal or urgent." })
            .optional(),
          escalationLevel: z
            .number()
            .int()
            .min(0)
            .max(MAX_ESCALATION_LEVEL)
            .optional(),
          decisionRequired: z.boolean().optional(),
          processedByName: optionalText("Processed by", {
            max: 160,
          }).optional(),
          decidedByName: optionalText("Decided by", { max: 160 }).optional(),
          communicatedByName: optionalText("Communicated by", {
            max: 160,
          }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;

        // A few of the fields `update` accepts are governed by capabilities other
        // than matter:update. Without this, each of the dedicated procedures -
        // flagForDirector, commissionerUpdate, the escalation ladder - would be
        // bypassable through the general one, and the capability would be a label
        // on a button rather than a boundary on the API. Stated once, for every
        // field that has one, and checked before the matter is read: a refusal
        // that depends on nothing but the caller's role and the request needs
        // nothing from the database to decide.
        const GUARDED_FIELDS: {
          field: keyof typeof updates;
          capability: Capability;
        }[] = [
          // §12B the Director's attention flag is the PA's instrument.
          { field: "decisionRequired", capability: "matter:flag" },
          // §14 the escalation ladder.
          { field: "escalationLevel", capability: "matter:escalate" },
          // §6/§12D the Director records what the Commission decided.
          { field: "decidedByName", capability: "matter:decide" },
        ];
        for (const { field, capability } of GUARDED_FIELDS) {
          if (updates[field] !== undefined && !can(ctx.user.role, capability)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: refusalFor(ctx.user.role, capability),
            });
          }
        }

        const before = await getCaseById(id);
        if (!before)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Matter not found",
          });

        // §17 the Golden Rule is enforced here, on the server, so it cannot be
        // bypassed by calling the API directly.
        if (updates.status && updates.status !== before.status) {
          const pendingReferral = before.referrals?.find(
            referral => referral.status === "pending"
          );
          // An explicit `null` clears the field and must be read as "now empty";
          // only `undefined` means "unchanged". `??` would conflate the two and
          // let a cleared outcome pass a closure check on the strength of the
          // value it used to hold.
          const keep = <T>(next: T | null | undefined, current: T | null) =>
            next === undefined ? current : next;
          const violations = checkGoldenRule({
            currentStatus: before.status,
            nextStatus: updates.status,
            actionRequired: keep(updates.actionRequired, before.actionRequired),
            outcome: keep(updates.outcome, before.outcome),
            dateClosed: keep(updates.dateClosed, before.dateClosed),
            communicatedByName: keep(
              updates.communicatedByName,
              before.communicatedByName
            ),
            awaitingResponse: ["REF", "LEG", "ADV"].includes(updates.status),
            referralResponseDueDate:
              pendingReferral?.responseDueDate ?? before.dueDate,
          });
          if (violations.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: violations.map(violation => violation.message).join(" "),
              cause: { violations },
            });
          }
        }

        // An officer's name is what the matter file shows, but the accountability
        // trail is counted by id, so the two are written together. Without this
        // the assigned-officer column stayed null for every matter ever created
        // and the delete guard that counts what an officer is still answerable
        // for was blind to assignments. The id is derived here, never accepted
        // from the client, so a caller cannot attach matters to any account.
        const write = {
          ...updates,
          ...(updates.assignedOfficerName !== undefined
            ? {
                assignedOfficerId: updates.assignedOfficerName
                  ? await findUserIdByName(updates.assignedOfficerName)
                  : null,
              }
            : {}),
        };

        const result = await updateCase(id, write);
        if (updates.status && before.status !== updates.status) {
          await addCaseEvent({
            caseId: id,
            eventType: "status_change",
            note: `Status changed from ${before.status} to ${updates.status}`,
            actorId: ctx.user.id,
            actorName: nameOf(ctx.user),
          });
        }
        if (
          updates.escalationLevel !== undefined &&
          updates.escalationLevel !== before.escalationLevel
        ) {
          await addCaseEvent({
            caseId: id,
            eventType: "escalation",
            note: `Escalated to ${escalationLabel(updates.escalationLevel)} (level ${updates.escalationLevel})`,
            actorId: ctx.user.id,
            actorName: nameOf(ctx.user),
          });
        }
        return result;
      }),
    /** §12C case brief prepared before a matter is presented to the Director. */
    saveBrief: requireCapability("brief:write")
      .input(
        z
          .object({
            id: recordId(),
            // Every section carries its own message, and the length floor comes
            // from `shared/` rather than being written out again. A bare
            // `z.string().min(4)` reaches the officer as a JSON array of schema
            // internals with no indication of which box on the form to look at;
            // these read as sentences naming the section.
            issue: briefSection("issue"),
            background: briefSection("background"),
            actionTaken: briefSection("actionTaken"),
            currentPosition: briefSection("currentPosition"),
            // Unconstrained here and checked below, because whether these two
            // are required at all depends on the flag in the same payload.
            issueRequiringDecision: conditionalBriefSection(),
            recommendation: conditionalBriefSection(),
            decisionRequired: z.boolean().default(false),
          })
          // Only the flag is checked here, because only the flag arrives in the
          // payload. The other half of `briefNeedsDecision` — a matter sitting at
          // DEC — depends on the stored status and is enforced in the resolver,
          // which reads it rather than believing a value the client sent.
          .superRefine((brief, ctx) => {
            if (!brief.decisionRequired) return;
            for (const key of CASE_BRIEF_CONDITIONAL_KEYS) {
              const field = CASE_BRIEF_FIELDS.find(item => item.key === key);
              if (!field) continue;
              const message = caseBriefFieldError(
                field,
                brief[key as "issueRequiringDecision" | "recommendation"]
              );
              if (message)
                ctx.addIssue({ code: "custom", path: [key], message });
            }
          })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...brief } = input;
        // The brief carries the Director's flag, which is the PA's instrument
        // under §12B, not a field of the case brief. Someone without matter:flag
        // can prepare the brief but cannot set the flag through it either.
        if (!can(ctx.user.role, "matter:flag")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: refusalFor(ctx.user.role, "matter:flag"),
          });
        }
        // A matter at DEC is asking the Director for a decision whether or not
        // the flag was set — the status says so — and the Director's queue is
        // built from `decisionRequired || status === "DEC"`. Enforcing the same
        // pair here is what stops a matter appearing in that queue with a brief
        // that never says what is being decided. The status is read from the
        // database rather than taken from the request: a client that declared its
        // own status could opt out of the check by lying about it.
        const before = await getCaseById(id);
        if (!before) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Matter not found.",
          });
        }
        if (briefNeedsDecision(brief.decisionRequired, before.status)) {
          const missing = CASE_BRIEF_CONDITIONAL_KEYS.map(key =>
            caseBriefFieldError(
              CASE_BRIEF_FIELDS.find(item => item.key === key)!,
              brief[key as "issueRequiringDecision" | "recommendation"]
            )
          ).filter((message): message is string => Boolean(message));
          if (missing.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `This matter is awaiting a decision from the Director, so the brief must say what is being decided. ${missing.join(" ")}`,
            });
          }
        }

        const result = await updateCase(id, {
          briefIssue: brief.issue,
          briefBackground: brief.background,
          briefActionTaken: brief.actionTaken,
          briefCurrentPosition: brief.currentPosition,
          // Null rather than an empty string when the matter is not flagged: the
          // columns are nullable, and "not applicable" is a different statement
          // from "written, and it said nothing". The Director's queue already
          // reads this with a fallback to the assigned action.
          briefIssueRequiringDecision: brief.issueRequiringDecision || null,
          briefRecommendation: brief.recommendation || null,
          briefPreparedByName: nameOf(ctx.user),
          briefPreparedAt: new Date(),
          decisionRequired: brief.decisionRequired,
        });
        await addCaseEvent({
          caseId: id,
          eventType: "case_brief",
          note: `Case brief prepared for the Director${brief.decisionRequired ? " — decision required" : ""}`,
          actorId: ctx.user.id,
          actorName: nameOf(ctx.user),
        });
        return result;
      }),
    /**
     * §12B "matters requiring the Director's attention". Flagging a matter is the
     * Professional Assistant's main instrument for monitoring: it is how a matter
     * reaches the Director's desk, and clearing the flag is how it leaves.
     *
     * Kept separate from `update` so the two are auditable. `update` moves a
     * matter through the workflow; this only changes whether the Director is
     * being asked to look at it.
     */
    flagForDirector: requireCapability("matter:flag")
      .input(
        z.object({
          id: recordId(),
          required: z.boolean(),
          note: optionalText("Note", { max: 500 }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const before = await getCaseById(input.id);
        if (!before)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Matter not found",
          });
        const result = await updateCase(input.id, {
          decisionRequired: input.required,
        });
        await addCaseEvent({
          caseId: input.id,
          eventType: "director_flag",
          note: input.required
            ? `Flagged for the Director's attention${input.note ? `: ${input.note}` : ""}`
            : `Removed from the Director's attention${input.note ? `: ${input.note}` : ""}`,
          actorId: ctx.user.id,
          actorName: nameOf(ctx.user),
        });
        return result;
      }),
    /**
     * §11 log an item against the matter's case file.
     *
     * The file bytes are optional. A logged-only entry is a deliberate part of
     * the manual - a class can be recorded as present before the scan is
     * attached - so `data` absent is a valid call, not a partial one. When it is
     * present the object goes to the same store the profile image uses.
     */
    addDocument: requireCapability("file:write")
      .input(
        z.object({
          caseId: recordId(),
          documentClass: z.enum(DOCUMENT_CLASS_KEYS, {
            error: "Choose which kind of document this is.",
          }),
          title: requiredText("Title", { min: 2, max: 200 }),
          note: optionalText("Note", { max: 2000 }).optional(),
          /** Base64 file body, without a data: URL prefix. */
          data: z.string().optional(),
          mimeType: z
            .enum(DOCUMENT_TYPES, { error: "That file type is not accepted." })
            .optional(),
          fileName: optionalText("File name", { max: 200 }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // A file cannot arrive without a name for it. Checked here rather than
        // in the schema so the two fields cannot be given independently.
        if (input.data && !input.mimeType) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The document could not be identified.",
          });
        }
        // A caller cannot smuggle a type past the client: the stored content
        // type has to be one we serve, so it is re-derived from the bytes.
        if (input.mimeType && !DOCUMENT_TYPES.includes(input.mimeType)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That file type cannot be stored.",
          });
        }

        let fileKey: string | null = null;
        let fileSize: number | null = null;
        let fileName = input.fileName ?? null;
        let mimeType: string | null = null;

        if (input.data) {
          const buffer = Buffer.from(input.data, "base64");
          // Re-checked after decoding: a malformed base64 string yields fewer
          // bytes than it appears to, so the encoded length proves nothing.
          if (buffer.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That file could not be read.",
            });
          }
          if (buffer.length > DOCUMENT_MAX_BYTES) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Case documents must be ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB or smaller. That one is ${(buffer.length / 1024 / 1024).toFixed(1)} MB.`,
            });
          }

          // The declared type has to agree with what the bytes are, checked
          // against the sniffed type rather than merely "is this a format we
          // know". Believing the declaration would let a caller store an
          // executable as application/octet-stream and have it served back as
          // such; and quietly accepting a mismatch would leave the officer
          // believing they attached a photo when what was stored is a PDF.
          const sniffed = sniffDocument(buffer);
          if (!sniffed || sniffed !== input.mimeType) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "That file's contents do not match its type. Attach the " +
                `original file rather than renaming it, and use one of: ${DOCUMENT_TYPE_LABELS.join(", ")}.`,
            });
          }

          const extension = DOCUMENT_EXTENSIONS[sniffed];
          const wantedKey = `cases/${input.caseId}/${
            DOCUMENT_CLASS_KEYS.indexOf(input.documentClass) + 1
          }-${Date.now()}.${extension}`;
          try {
            // The key that comes back is the one to record, not the one asked
            // for: storagePut appends a hash suffix, so storing the requested
            // key would leave the row pointing at an object that does not exist
            // and every download on the case file would 404.
            const stored = await storagePut(wantedKey, buffer, sniffed);
            fileKey = stored.key;
          } catch (cause) {
            console.error("[CaseFile] document upload failed:", cause);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "The document could not be stored. Try again in a moment, or contact the platform administrator.",
            });
          }
          fileSize = buffer.length;
          mimeType = sniffed;
          // The stored name is the sniffed extension on the officer's stem, so a
          // renamed ".exe" cannot be written to the store as ".pdf" and later
          // served back under a document type.
          if (fileName) {
            fileName = fileName.replace(/\.[^.]*$/, "") + `.${extension}`;
          }
        }

        return addCaseDocument({
          caseId: input.caseId,
          documentClass: input.documentClass,
          title: input.title,
          note: input.note ?? null,
          fileKey,
          fileName,
          fileSize,
          mimeType,
          loggedById: ctx.user.id,
          loggedByName: nameOf(ctx.user),
        });
      }),
    /**
     * §11 remove a document from the case file.
     *
     * Gated on the same capability that adds one, so a role cannot file a
     * document it is not allowed to unfile. The removal is recorded on the
     * activity timeline by the database layer, and the object is removed from
     * storage here - a row deleted while its file is left behind would be an
     * orphan nobody can reach and nobody accounts for.
     */
    removeDocument: requireCapability("file:write")
      .input(
        z.object({
          id: recordId("document"),
          caseId: recordId(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await deleteCaseDocument({
          id: input.id,
          caseId: input.caseId,
          actorId: ctx.user.id,
          actorName: nameOf(ctx.user),
        });
        if (!result) {
          // Not a server fault: the document is not on this matter, which is
          // also what a caller gets for a document that never existed or was
          // already removed. Saying so is better than a 500, and it does not
          // confirm the existence of a document on some other matter.
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That document is not on this matter.",
          });
        }
        if (result.fileKey) {
          await storageDelete(result.fileKey);
        }
        return result.case;
      }),
    /**
     * §12D follow-up: record the National Section's response. Gated on its own
     * capability because under §12 this is the Professional Assistant's standing
     * duty - monitoring what the National Sections have been asked and chasing
     * them to an answer - rather than casework on a matter they hold.
     */
    recordReferralResponse: requireCapability("referral:followUp")
      .input(
        z.object({
          referralId: recordId("referral"),
          responseSummary: requiredText("Response summary", {
            min: 4,
            max: 2000,
          }),
          responseReceivedAt: dateField().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        recordReferralResponse({
          ...input,
          recordedById: ctx.user.id,
          recordedByName: nameOf(ctx.user),
        })
      ),
    addEvent: requireCapability("matter:update")
      .input(
        z.object({
          caseId: recordId(),
          eventType: requiredText("Event type", { min: 2, max: 60 }),
          note: requiredText("Note", { min: 2, max: 2000 }),
        })
      )
      .mutation(({ ctx, input }) =>
        addCaseEvent({
          ...input,
          actorId: ctx.user.id,
          actorName: nameOf(ctx.user),
        })
      ),
    refer: requireCapability("matter:refer")
      .input(
        z.object({
          caseId: recordId(),
          destination: requiredText("National Section", { min: 2, max: 160 }),
          reason: requiredText("Reason for referral", { min: 8, max: 2000 }),
          // §5 the officer records which referral triggers applied. Validated in
          // the handler rather than by zod so the message stays readable.
          criteria: z
            .array(z.enum(REFERRAL_CRITERION_KEYS), {
              error: "One of the referral criteria is not recognised.",
            })
            .optional(),
          responseDueDate: dateField().nullable().optional(),
          // §6 the Director must be notified before a legal matter leaves the province.
          directorNotifiedName: optionalText("Director notified", {
            max: 160,
          }).optional(),
          // §8 required statement set for Industrial and General referrals.
          statementClaim: optionalText("What the teacher is claiming", {
            max: 2000,
          }).optional(),
          statementVerified: optionalText("What the province verified", {
            max: 2000,
          }).optional(),
          statementUnresolved: optionalText("What remains unresolved", {
            max: 2000,
          }).optional(),
          statementAdviceRequired: optionalText("Advice required", {
            max: 2000,
          }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!input.criteria?.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Select at least one reason for referral. A provincial officer should record the trigger that took the matter outside their authority.",
          });
        }
        // §6: any legal trigger routes the matter to the Legal Section, whatever
        // the category says, and provincial officers must not opine on it.
        const legal = isLegalReferral(input.criteria);
        if (legal && !input.directorNotifiedName?.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Legal referral: record the Director, Provincial Matters, as notified before the matter goes to the Legal Section.",
          });
        }
        if (input.destination === "Industrial and General") {
          const missing = (
            [
              "statementClaim",
              "statementVerified",
              "statementUnresolved",
              "statementAdviceRequired",
            ] as const
          ).filter(field => !input[field]?.trim());
          if (missing.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "An Industrial and General referral must state what the teacher claims, what the province verified, what remains unresolved, and what decision or advice is required.",
            });
          }
        }
        // §17: no referred matter should remain without follow-up.
        if (!input.responseDueDate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Golden Rule: no referred matter should remain without follow up. Set a response due date.",
          });
        }
        return createReferral({
          ...input,
          isLegal: legal,
          referredById: ctx.user.id,
          referredByName: nameOf(ctx.user),
        });
      }),
    /**
     * The Commission decides; the Director records what was decided (§6, §12D).
     *
     * Moves the matter to "Awaiting decision" — DEC records that a decision is
     * outstanding, and the matter is closed later through `update` with the
     * outcome, date and communication the Golden Rule requires. It is written to
     * the activity trail like every other change to a matter: a decision that
     * leaves no event is a decision the accountability record cannot account for.
     */
    commissionerUpdate: requireCapability("matter:decide")
      .input(
        z.object({
          id: recordId(),
          decidedByName: requiredText("Decided by", { min: 2, max: 160 }),
          outcome: requiredText("Outcome", { min: 8, max: 4000 }),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const before = await getCaseById(input.id);
        if (!before) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Matter not found",
          });
        }
        const result = await updateCase(input.id, {
          decidedByName: input.decidedByName,
          outcome: input.outcome,
          status: "DEC",
        });
        await addCaseEvent({
          caseId: input.id,
          eventType: "decision",
          note: `Decision recorded by ${input.decidedByName}: ${input.outcome}`,
          actorId: ctx.user.id,
          actorName: nameOf(ctx.user),
        });
        return result;
      }),
    adminPing: adminProcedure.query(() => ({ ok: true })),
  }),
  /**
   * Platform oversight. The super admin looks after the platform itself:
   * who has access, what has happened across the whole register, and the
   * health of the system. Every route re-checks the tier server-side, so
   * hiding the nav item is convenience, not the security boundary.
   */
  /**
   * §12E reporting for the Director and §17 compliance visibility. Protected
   * rather than super-admin: these are the division's normal working reports.
   */
  reports: router({
    /** §13 the one-page Director's weekly brief, sections A-F. */
    weeklyBrief: requireCapability("report:view").query(() => getWeeklyBrief()),
    /** §18.8 monthly provincial matters report. */
    monthly: requireCapability("report:view")
      .input(
        z
          .object({
            month: z
              .string()
              .trim()
              .regex(/^\d{4}-\d{2}$/, {
                error: "Choose a month, in the form 2026-01.",
              })
              .optional(),
          })
          .optional()
      )
      .query(({ input }) => getMonthlyReport(input?.month)),
    /**
     * §12E quarterly performance report. The same `report:view` capability as
     * the weekly and monthly sets: §12E has the Professional Assistant preparing
     * all three, so splitting the gate would only mean two lists to keep in step.
     */
    quarterly: requireCapability("report:view")
      .input(
        z
          .object({
            quarter: z
              .string()
              .trim()
              .regex(/^\d{4}-Q[1-4]$/, {
                error: "Choose a quarter, in the form 2026-Q1.",
              })
              .optional(),
          })
          .optional()
      )
      .query(({ input }) => getQuarterlyReport(input?.quarter)),
    /** The quarters offered in the period picker. */
    quarters: requireCapability("report:view").query(() => listQuarters(4)),
    /** §18.9 provincial officer performance report. */
    officerPerformance: requireCapability("report:view").query(() =>
      getOfficerPerformance()
    ),
    /** §17 Golden Rule compliance across the register. */
    goldenRule: requireCapability("report:view").query(() =>
      getGoldenRuleCompliance()
    ),
  }),
  admin: router({
    stats: requireCapability("platform:stats").query(() => getSystemStats()),
    /**
     * The officer names the oversight screen offers in its reassignment picker.
     * Gated on platform:oversight rather than platform:stats, because that picker
     * is the oversight screen's own control: on platform:stats the Administrator
     * tier - which holds oversight - was refused the list it needed to reassign a
     * matter, and the capability it does hold stopped being usable.
     */
    officers: requireCapability("platform:oversight").query(() =>
      listOfficers()
    ),
    provinces: requireCapability("platform:oversight").query(() =>
      listProvinces()
    ),
    users: router({
      list: requireCapability("platform:users").query(() => listUsers()),
      /**
       * Create an account.
       *
       * The email is now required, not optional, because it is the address
       * Supabase signs the officer in with and the one a reset link goes to.
       * A username is optional and is a register-side label only: it no longer
       * identifies anybody at sign-in, and a person cannot be locked out by
       * choosing a name that is already taken.
       *
       * The password is optional. Left out, the officer sets their own on first
       * sign-in via a reset link, which means no administrator ever handles
       * somebody else's credential.
       */
      create: requireCapability("platform:users")
        .input(
          z.object({
            name: requiredText("Full name", { min: 2, max: 160 }),
            email: emailAddress(),
            username: z
              .string()
              .min(3)
              .max(64)
              .regex(
                /^[a-z0-9._-]+$/i,
                "Letters, numbers, dot, underscore and hyphen only."
              )
              .optional(),
            role: roleEnum,
            password: requiredText("Password", {
              min: 10,
              max: 200,
            }).optional(),
          })
        )
        .mutation(async ({ input }) => {
          if (input.username && (await usernameTaken(input.username))) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `The username "${input.username}" is already taken.`,
            });
          }
          try {
            return await provisionUser({
              name: input.name,
              email: input.email,
              username: input.username ?? null,
              role: input.role as Role,
              password: input.password ?? null,
            });
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: String(error instanceof Error ? error.message : error),
            });
          }
        }),
      setRole: requireCapability("platform:users")
        .input(
          z.object({
            id: recordId("officer"),
            role: roleEnum,
          })
        )
        .mutation(async ({ ctx, input }) => {
          if (input.id === ctx.user.id && input.role !== "super_admin") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You cannot remove your own super administrator role.",
            });
          }
          // Never leave the platform without a way back in.
          if (input.role !== "super_admin") {
            const remaining = (await listUsers()).filter(
              user =>
                user.isActive &&
                user.role === "super_admin" &&
                user.id !== input.id
            );
            if (!remaining.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "At least one active super administrator must remain.",
              });
            }
          }
          return setUserRole(input.id, input.role as Role);
        }),
      /** Attach or change the register-side label on an existing account. */
      setUsername: requireCapability("platform:users")
        .input(
          z.object({
            id: recordId("officer"),
            // A sign-in name, not a display name: the pattern is the rule the
            // login form and the admin screen both rely on, so the message says
            // which characters are allowed rather than only that it is invalid.
            username: z
              .string()
              .trim()
              .min(3, { error: "Username must be at least 3 characters." })
              .max(64, { error: "Username must be 64 characters or fewer." })
              .regex(/^[a-z0-9._-]+$/i, {
                error: "Use letters, numbers, dot, underscore and hyphen only.",
              }),
          })
        )
        .mutation(async ({ input }) => {
          if (await usernameTaken(input.username, input.id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `The username "${input.username}" is already taken.`,
            });
          }
          await setUserUsername(input.id, input.username);
          return { ok: true };
        }),
      /**
       * Remove an account outright.
       *
       * Refused in three cases, each of which would either lock the platform out
       * or quietly damage the register:
       *   - deleting yourself, which would end your session mid-action;
       *   - deleting the last active platform administrator, with no way back in;
       *   - deleting anyone who appears in the accountability trail. §15 requires
       *     that every office handling a matter stays identifiable, and there are
       *     no foreign keys to stop a delete from orphaning those rows. Deactivate
       *     the account instead: it keeps the trail and closes the sign-in.
       */
      delete: requireCapability("platform:users")
        .input(z.object({ id: recordId() }))
        .mutation(async ({ ctx, input }) => {
          // Checked before anything is read, so the guard does not depend on a
          // database round trip and cannot be reordered past the lookups.
          if (input.id === ctx.user.id) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You cannot delete your own account.",
            });
          }
          const target = (await listUsers()).find(u => u.id === input.id);
          if (!target)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Account not found",
            });
          if (target.role === "super_admin") {
            const others = (await listUsers()).filter(
              u => u.isActive && u.role === "super_admin" && u.id !== input.id
            );
            if (!others.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "At least one active platform administrator must remain.",
              });
            }
          }
          const refs = await getUserReferences(input.id);
          if (refs.total > 0) {
            const parts = [
              refs.casesCreated
                ? `${refs.casesCreated} matter(s) registered`
                : null,
              refs.casesAssigned
                ? `${refs.casesAssigned} matter(s) assigned`
                : null,
              refs.events ? `${refs.events} recorded action(s)` : null,
              refs.referrals ? `${refs.referrals} referral(s)` : null,
              refs.documents ? `${refs.documents} case file item(s)` : null,
            ].filter(Boolean);
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `This person appears in the accountability trail (${parts.join(", ")}), so deleting them would break the accountability trail. Deactivate the account instead — it closes the sign-in and keeps the record.`,
            });
          }
          // The Supabase identity is cleared before the row goes, so a failure
          // between the two steps leaves an identity that can no longer resolve
          // to a row rather than one that still can.
          const authUserId = await getAuthUserIdForUser(input.id);
          if (authUserId) {
            await clearAuthLink(input.id);
            await removeIdentity(authUserId).catch(error => {
              // Logged, not raised: the register row is the accountability
              // record and its deletion is the requested outcome. Refusing here
              // would leave an officer's row alive because of a failure in a
              // system that no longer matters for their sign-in.
              console.error(
                `[Admin] Account ${input.id} deleted, but its Supabase identity could not be removed:`,
                error
              );
            });
          }
          await deleteUser(input.id);
          console.log(
            `[Admin] Account ${target.name ?? target.email ?? input.id} deleted`
          );
          return { ok: true };
        }),
      /**
       * Issue a password-reset link for an account.
       *
       * The link is a bearer credential, so it is returned once to the
       * administrator and never stored. The officer sets their own password
       * through it, which is the reason this is preferred to `setPassword`
       * below: an administrator handling somebody's password is a risk that
       * does not arise at all if they never handle it.
       */
      sendResetLink: requireCapability("platform:users")
        .input(z.object({ id: recordId("officer") }))
        .mutation(async ({ input }) => {
          const target = (await listUsers()).find(user => user.id === input.id);
          if (!target)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Account not found",
            });
          if (!target.email) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This account has no email address, so there is nowhere to send a reset link.",
            });
          }
          if (!target.authUserId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This account has no Supabase identity yet, so it cannot sign in. Delete it and create it again.",
            });
          }
          try {
            return { ok: true, link: await issuePasswordReset(target.email) };
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: String(error instanceof Error ? error.message : error),
            });
          }
        }),
      /**
       * Set a password directly, without sending a link.
       *
       * Kept for a deployment with no working email, where a reset link cannot
       * be delivered and an officer locked out of the register would otherwise
       * have no way back in. It handles a real password, which is why the link
       * above is the default.
       */
      setPassword: requireCapability("platform:users")
        .input(
          z.object({
            id: recordId("officer"),
            password: requiredText("Password", { min: 10, max: 200 }),
          })
        )
        .mutation(async ({ input }) => {
          const target = (await listUsers()).find(user => user.id === input.id);
          if (!target)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Account not found",
            });
          if (!target.authUserId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This account has no Supabase identity, so there is no password to set.",
            });
          }
          try {
            await setPasswordDirectly(target.authUserId, input.password);
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: String(error instanceof Error ? error.message : error),
            });
          }
          // The value is not logged. The account is, because an audit line with
          // no subject is not an audit line.
          console.log(
            `[Admin] Password set directly for ${target.name ?? target.email ?? input.id}`
          );
          return { ok: true };
        }),
      setActive: requireCapability("platform:users")
        .input(z.object({ id: recordId("officer"), isActive: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          if (input.id === ctx.user.id && !input.isActive) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "You cannot deactivate your own account.",
            });
          }
          if (!input.isActive) {
            const target = (await listUsers()).find(
              user => user.id === input.id
            );
            if (target?.role === "super_admin") {
              const others = (await listUsers()).filter(
                user =>
                  user.isActive &&
                  user.role === "super_admin" &&
                  user.id !== input.id
              );
              if (!others.length) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "At least one active super administrator must remain.",
                });
              }
            }
          }
          return setUserActive(input.id, input.isActive);
        }),
    }),
    audit: router({
      eventTypes: requireCapability("platform:audit").query(() =>
        listAuditEventTypes()
      ),
      /**
       * The global audit trail, paged like the register.
       *
       * The ceiling is what a single screen can usefully show, and it is enforced
       * on both ends. What matters more is that the search and the type filter
       * run in the database before the page is taken, so an officer looking for
       * an action from months ago finds it rather than being shown the newest
       * 200 events with the answer somewhere beyond them.
       */
      list: requireCapability("platform:audit")
        .input(
          z
            .object({
              search: searchTerm(),
              eventType: z
                .string()
                .trim()
                .max(60, {
                  error: "Event type must be 60 characters or fewer.",
                })
                .optional(),
              ...pageBounds(OVERSIGHT_PAGE_SIZE),
            })
            .optional()
        )
        .query(({ input }) =>
          listAuditLog({
            ...input,
            limit: input?.limit ?? AUDIT_PAGE_SIZE,
            offset: input?.offset ?? 0,
          })
        ),
    }),
    cases: router({
      /**
       * Every matter in the register, regardless of assigned officer.
       *
       * Paged on the same terms as the register, and for the same reason: this
       * is the one screen that deliberately ignores the assigned officer, so it
       * has the most to show of any list in the app and was the last one still
       * asking for all of it at once.
       */
      list: requireCapability("platform:oversight")
        .input(
          z
            .object({
              search: searchTerm(),
              status: statusEnum.optional(),
              matterType: matterTypeEnum.optional(),
              province: z.string().trim().max(80).optional(),
              overdueOnly: z.boolean().optional(),
              ...pageBounds(OVERSIGHT_PAGE_SIZE),
            })
            .optional()
        )
        .query(({ input }) =>
          listCasesPage(input, {
            limit: input?.limit ?? OVERSIGHT_PAGE_SIZE,
            offset: input?.offset ?? 0,
          })
        ),
      reassign: requireCapability("platform:oversight")
        .input(
          z.object({
            id: recordId(),
            assignedOfficerName: requiredText("Assigned officer", {
              min: 2,
              max: 160,
            }),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const before = await getCaseById(input.id);
          const result = await updateCase(input.id, {
            assignedOfficerName: input.assignedOfficerName,
            assignedOfficerId: await findUserIdByName(
              input.assignedOfficerName
            ),
          });
          await addCaseEvent({
            caseId: input.id,
            eventType: "oversight_reassignment",
            note: `Oversight reassignment from ${before?.assignedOfficerName || "Unassigned"} to ${input.assignedOfficerName}`,
            actorId: ctx.user.id,
            actorName: nameOf(ctx.user),
          });
          return result;
        }),
      setStatus: requireCapability("platform:oversight")
        .input(
          z.object({
            id: recordId(),
            status: statusEnum,
            note: requiredText("Note", { min: 3, max: 500 }),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const before = await getCaseById(input.id);
          if (!before) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Matter not found",
            });
          }
          if (before.status === input.status) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The matter is already at that status.",
            });
          }
          // §17 applies to an oversight override as much as to an officer's own
          // change. Without this check the override was the one route that could
          // close a matter with no outcome, no date and no record of who
          // communicated it - and the compliance report would then count that
          // breach against the province. Oversight corrects a record; it does not
          // suspend the rule the record is measured against.
          //
          // A matter the Golden Rule already refuses to let anyone close cannot
          // be closed here either, including by the override the screen exists to
          // provide: an oversight correction to a wrong *status* is legitimate,
          // but one that manufactures a missing outcome is not a correction.
          const violations = checkGoldenRule({
            currentStatus: before.status,
            nextStatus: input.status,
            actionRequired: before.actionRequired,
            outcome: before.outcome,
            dateClosed: before.dateClosed,
            communicatedByName: before.communicatedByName,
            awaitingResponse: ["REF", "LEG", "ADV"].includes(input.status),
            referralResponseDueDate: before.dueDate,
          });
          if (violations.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: violations.map(violation => violation.message).join(" "),
              cause: { violations },
            });
          }
          const result = await updateCase(input.id, { status: input.status });
          await addCaseEvent({
            caseId: input.id,
            eventType: "oversight_status",
            note: `Oversight status change from ${before?.status || "—"} to ${input.status}: ${input.note}`,
            actorId: ctx.user.id,
            actorName: nameOf(ctx.user),
          });
          return result;
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
