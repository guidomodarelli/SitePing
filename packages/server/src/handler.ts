import {
  type FeedbackCreateInput,
  type FeedbackRecord,
  flattenAnnotation,
  isStoreDuplicate,
  isStoreNotFound,
  type SitepingStore,
  toFeedbackUpdate,
} from "@siteping/core";
import {
  type AccessGate,
  accessGateFromControl,
  type SitepingAccessControl,
  type SitepingAuthorizationContext,
  type SitepingHttpMethod,
  type SitepingRequestContext,
} from "./access.js";
import { type ApiKeyAccessOptions, createApiKeyGate } from "./api-key-access.js";
import { buildCorsHeaders, type CorsHeaders, withCors } from "./cors.js";
import {
  feedbackCreateSchema,
  feedbackDeleteSchema,
  feedbackPatchSchema,
  formatValidationErrors,
  getQuerySchema,
} from "./validation.js";
import { dispatchWebhooks, type WebhookConfig } from "./webhooks.js";

/** Most annotations accepted on one feedback (also enforced by the schema). */
const MAX_ANNOTATIONS_PER_FEEDBACK = 50;

/** Query parameters the list endpoint reads. */
const LIST_QUERY_KEYS = [
  "projectName",
  "page",
  "limit",
  "type",
  "status",
  "statuses",
  "search",
  "url",
  "urlPattern",
] as const;

/** What a delete targets — one record, or a whole project (`deleteAll`). */
export type SitepingDeletionTarget =
  | { kind: "single"; id: string; projectName: string }
  | { kind: "project"; projectName: string };

/**
 * Side effects around persistence — issue trackers, chat notifications,
 * search indexes, audit logs. Hooks receive the raw stored record.
 *
 * `onCreated` / `onUpdated` / `onDeleted` are awaited before the response
 * (so serverless runtimes do not freeze them mid-flight); a throw is logged
 * and never fails the request — the write already happened.
 * `onDeleting` runs before the delete: throw to abort it (the record is kept
 * and the request answers 502), e.g. when an external resource tied to the
 * feedback could not be cleaned up and must be retried.
 */
export interface SitepingLifecycleHooks<Principal> {
  onCreated?(feedback: FeedbackRecord, context: SitepingRequestContext<Principal>): void | Promise<void>;
  onUpdated?(feedback: FeedbackRecord, context: SitepingRequestContext<Principal>): void | Promise<void>;
  onDeleting?(target: SitepingDeletionTarget, context: SitepingRequestContext<Principal>): void | Promise<void>;
  onDeleted?(target: SitepingDeletionTarget, context: SitepingRequestContext<Principal>): void | Promise<void>;
}

/** Structured logger; defaults to `console.error`. */
export interface SitepingLogger {
  error(message: string, context: Record<string, unknown>): void;
}

interface SitepingHandlerBaseOptions<Principal> {
  /** Persistence backend — any `SitepingStore` (Prisma, Drizzle, memory, your own). */
  store: SitepingStore;
  /** Allowed CORS origins — when set, only those origins are reflected. */
  allowedOrigins?: ReadonlyArray<string> | undefined;
  /**
   * Rewrite the validated create input before it is stored: impose the
   * project or author from the session, redact secrets from free text,
   * drop fields you do not keep. Runs before the authorization check, so
   * `authorize` sees the effective `projectName`.
   */
  beforeCreate?(
    input: FeedbackCreateInput,
    context: SitepingRequestContext<Principal>,
  ): FeedbackCreateInput | Promise<FeedbackCreateInput>;
  /**
   * Transform each record right before it is serialized in a response —
   * e.g. read-time redaction. `clientId` is always stripped afterwards.
   */
  presentFeedback?(feedback: FeedbackRecord, context: SitepingRequestContext<Principal>): FeedbackRecord;
  /** Lifecycle side effects. See `SitepingLifecycleHooks`. */
  hooks?: SitepingLifecycleHooks<Principal>;
  /**
   * Outgoing webhooks fired after a feedback is created (Slack, Discord or
   * generic JSON). Fire-and-forget; observe failures via each config's `onError`.
   */
  webhooks?: WebhookConfig | ReadonlyArray<WebhookConfig>;
  /** Where unexpected failures are reported. Defaults to `console.error`. */
  logger?: SitepingLogger;
  /**
   * Map a store failure to the `error` string sent to the client. Return
   * `undefined` for the default ("Internal server error"). Adapters use it
   * for actionable setup hints (e.g. "table not found, run migrations").
   */
  describeError?(error: unknown): string | undefined;
}

/** Built-in shared-secret policy (backwards compatible with `adapter-prisma`). */
export interface SitepingApiKeyHandlerOptions extends SitepingHandlerBaseOptions<never>, ApiKeyAccessOptions {
  access?: never;
}

/** Custom access policy — sessions, JWT, roles… */
export interface SitepingAccessHandlerOptions<Principal> extends SitepingHandlerBaseOptions<Principal> {
  access: SitepingAccessControl<Principal>;
  apiKey?: never;
  publicEndpoints?: never;
  requireAuthForDestructive?: never;
  redactUnauthenticatedEmails?: never;
}

/** Options of `createSitepingHandler` — `access` XOR the api-key options. */
export type SitepingHandlerOptions<Principal = never> =
  | SitepingApiKeyHandlerOptions
  | SitepingAccessHandlerOptions<Principal>;

/** One handler per HTTP method — mount them on any Fetch-API router. */
export interface SitepingHandler {
  OPTIONS: (request: Request) => Response;
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
}

const defaultLogger: SitepingLogger = {
  error(message, context) {
    console.error(message, context);
  },
};

/**
 * Serialize a record for the wire. `clientId` is always stripped — it is a
 * browser-local dedup secret, and the POST dedup path returns the full
 * record to whoever presents it. `authorEmail` is blanked unless allowed.
 */
function toWireFeedback(feedback: FeedbackRecord, includeEmail: boolean): Omit<FeedbackRecord, "clientId"> {
  const { clientId: _clientId, ...wire } = feedback;
  return includeEmail ? wire : { ...wire, authorEmail: "" };
}

function toWebhookList(webhooks: SitepingHandlerBaseOptions<unknown>["webhooks"]): ReadonlyArray<WebhookConfig> {
  if (!webhooks) return [];
  return Array.isArray(webhooks) ? (webhooks as ReadonlyArray<WebhookConfig>) : [webhooks as WebhookConfig];
}

/**
 * Create the SitePing HTTP API over any `SitepingStore`, using only the
 * Fetch API (`Request` / `Response`) — mount it in Next.js route handlers,
 * Hono, Remix, SvelteKit, Bun/Deno servers or edge workers.
 *
 * Rate limiting is not handled here; apply it at the framework or proxy level.
 *
 * @example Next.js App Router with your own session auth
 * ```ts
 * export const { GET, POST, PATCH, DELETE, OPTIONS } = createSitepingHandler({
 *   store,
 *   access: {
 *     authenticate: (request) => getSessionUser(request),
 *     authorize: ({ principal, action }) => action === "create" || principal.isAdmin,
 *   },
 * });
 * ```
 */
export function createSitepingHandler<Principal>(options: SitepingAccessHandlerOptions<Principal>): SitepingHandler;
export function createSitepingHandler(options: SitepingApiKeyHandlerOptions): SitepingHandler;
export function createSitepingHandler<Principal>(options: SitepingHandlerOptions<Principal>): SitepingHandler {
  // The api-key branch never resolves a principal (always `null`), so both
  // branches share the callbacks typed over `Principal`.
  const {
    store,
    allowedOrigins,
    beforeCreate,
    presentFeedback,
    hooks,
    logger = defaultLogger,
    describeError,
  } = options as SitepingHandlerBaseOptions<Principal>;
  if (!store) {
    throw new Error("[siteping] createSitepingHandler requires a `store`.");
  }
  const gate: AccessGate<Principal> = options.access
    ? accessGateFromControl(options.access)
    : (createApiKeyGate(options) as AccessGate<Principal>);
  const webhookList = toWebhookList(options.webhooks);

  const errorResponse = (status: number, error: string, corsHeaders: CorsHeaders): Response =>
    withCors(Response.json({ error }, { status }), corsHeaders);

  const internalError = (operation: string, error: unknown, corsHeaders: CorsHeaders): Response => {
    logger.error(`[siteping] createSitepingHandler: ${operation} failed`, { error });
    return errorResponse(500, describeError?.(error) ?? "Internal server error", corsHeaders);
  };

  /** Run a post-write hook; its failure is logged, never surfaced. */
  const runHook = async (name: string, invoke: () => void | Promise<void>): Promise<void> => {
    try {
      await invoke();
    } catch (error) {
      logger.error(`[siteping] createSitepingHandler: hook ${name} failed`, { error });
    }
  };

  /** Authenticate, returning a response to send on refusal. */
  const authenticate = async (request: Request, method: SitepingHttpMethod, corsHeaders: CorsHeaders) => {
    const outcome = await gate.authenticate(request, method);
    if (!outcome.ok) return { refusal: errorResponse(outcome.status, outcome.error, corsHeaders) } as const;
    return {
      context: { request, principal: outcome.principal } satisfies SitepingRequestContext<Principal>,
      canReadAuthorEmail: outcome.canReadAuthorEmail,
    } as const;
  };

  const authorize = async (authorization: SitepingAuthorizationContext<Principal>, corsHeaders: CorsHeaders) =>
    (await gate.authorize(authorization)) ? null : errorResponse(403, "Forbidden", corsHeaders);

  const present = (feedback: FeedbackRecord, context: SitepingRequestContext<Principal>, includeEmail: boolean) =>
    toWireFeedback(presentFeedback ? presentFeedback(feedback, context) : feedback, includeEmail);

  const readJson = (request: Request): Promise<unknown> => request.json().catch(() => null);

  return {
    /** CORS preflight. Configure `allowedOrigins` for cross-origin widgets. */
    OPTIONS: (request: Request): Response => {
      return new Response(null, { status: 204, headers: buildCorsHeaders(request, allowedOrigins) });
    },

    POST: async (request: Request): Promise<Response> => {
      const corsHeaders = buildCorsHeaders(request, allowedOrigins);
      const authentication = await authenticate(request, "POST", corsHeaders);
      if ("refusal" in authentication) return authentication.refusal;
      const { context } = authentication;

      const body = await readJson(request);
      if (!body) return errorResponse(400, "Invalid JSON", corsHeaders);
      const parsed = feedbackCreateSchema.safeParse(body);
      if (!parsed.success) {
        return withCors(Response.json({ errors: formatValidationErrors(parsed.error) }, { status: 400 }), corsHeaders);
      }
      const data = parsed.data;
      // Defense-in-depth on top of the schema limit.
      if (data.annotations.length > MAX_ANNOTATIONS_PER_FEEDBACK) {
        return errorResponse(400, `Too many annotations (max ${MAX_ANNOTATIONS_PER_FEEDBACK})`, corsHeaders);
      }

      try {
        const validatedInput: FeedbackCreateInput = {
          projectName: data.projectName,
          type: data.type,
          message: data.message,
          status: "open",
          url: data.url,
          urlPattern: data.urlPattern ?? null,
          viewport: data.viewport,
          userAgent: data.userAgent,
          authorName: data.authorName,
          authorEmail: data.authorEmail,
          clientId: data.clientId,
          annotations: data.annotations.map(flattenAnnotation),
          screenshotDataUrl: data.screenshotDataUrl ?? null,
          screenshotRegion: data.screenshotRegion ?? null,
          diagnostics: data.diagnostics ?? null,
        };
        const input = beforeCreate ? await beforeCreate(validatedInput, context) : validatedInput;

        const refusal = await authorize({ ...context, action: "create", projectName: input.projectName }, corsHeaders);
        if (refusal) return refusal;

        /**
         * A clientId is unique across the store, so a replay resolving to
         * another project's record is a boundary violation, not a dedup.
         * Email stays intact otherwise: the requester supplied it (fresh
         * insert) or proved ownership by presenting the clientId (replay).
         */
        const created = (feedback: FeedbackRecord): Response => {
          if (feedback.projectName !== input.projectName) {
            return errorResponse(409, "clientId already used by another project", corsHeaders);
          }
          return withCors(Response.json(present(feedback, context, true), { status: 201 }), corsHeaders);
        };

        // Replay detection up front: a replayed submission must not notify
        // hooks or webhooks a second time.
        const replayed = await store.findByClientId(input.clientId);
        if (replayed) return created(replayed);

        let feedback: FeedbackRecord;
        try {
          feedback = await store.createFeedback(input);
        } catch (error) {
          // Unique-constraint race: the same clientId landed between the
          // replay check and the insert. The presenter still owns the record.
          if (isStoreDuplicate(error)) {
            const existing = await store.findByClientId(input.clientId);
            if (existing) return created(existing);
          }
          throw error;
        }

        if (feedback.projectName === input.projectName) {
          if (webhookList.length > 0) void dispatchWebhooks(webhookList, feedback);
          if (hooks?.onCreated) await runHook("onCreated", () => hooks.onCreated?.(feedback, context));
        }
        return created(feedback);
      } catch (error) {
        return internalError("create feedback", error, corsHeaders);
      }
    },

    GET: async (request: Request): Promise<Response> => {
      const corsHeaders = buildCorsHeaders(request, allowedOrigins);
      const authentication = await authenticate(request, "GET", corsHeaders);
      if ("refusal" in authentication) return authentication.refusal;
      const { context, canReadAuthorEmail } = authentication;

      const searchParams = new URL(request.url).searchParams;
      const rawQuery: Record<string, string> = {};
      for (const key of LIST_QUERY_KEYS) {
        const value = searchParams.get(key);
        if (value !== null) rawQuery[key] = value;
      }
      const parsed = getQuerySchema.safeParse(rawQuery);
      if (!parsed.success) {
        return withCors(Response.json({ errors: formatValidationErrors(parsed.error) }, { status: 400 }), corsHeaders);
      }

      try {
        const refusal = await authorize(
          { ...context, action: "list", projectName: parsed.data.projectName },
          corsHeaders,
        );
        if (refusal) return refusal;
        const page = await store.getFeedbacks(parsed.data);
        const body = {
          ...page,
          feedbacks: page.feedbacks.map((feedback) => present(feedback, context, canReadAuthorEmail)),
        };
        return withCors(Response.json(body, { headers: { "Cache-Control": "private, max-age=5" } }), corsHeaders);
      } catch (error) {
        return internalError("list feedbacks", error, corsHeaders);
      }
    },

    PATCH: async (request: Request): Promise<Response> => {
      const corsHeaders = buildCorsHeaders(request, allowedOrigins);
      const authentication = await authenticate(request, "PATCH", corsHeaders);
      if ("refusal" in authentication) return authentication.refusal;
      const { context, canReadAuthorEmail } = authentication;

      const body = await readJson(request);
      if (!body) return errorResponse(400, "Invalid JSON", corsHeaders);
      const parsed = feedbackPatchSchema.safeParse(body);
      if (!parsed.success) {
        return withCors(Response.json({ errors: formatValidationErrors(parsed.error) }, { status: 400 }), corsHeaders);
      }
      const { id, projectName, status } = parsed.data;

      try {
        const refusal = await authorize({ ...context, action: "update", projectName, feedbackId: id }, corsHeaders);
        if (refusal) return refusal;
        // Cross-project guard for stores implementing the optional check.
        if (store.verifyProjectOwnership && !(await store.verifyProjectOwnership(id, projectName))) {
          return errorResponse(404, "Feedback not found", corsHeaders);
        }
        // resolvedAt (closure timestamp) is derived here at the edge.
        const feedback = await store.updateFeedback(id, toFeedbackUpdate(status));
        if (hooks?.onUpdated) await runHook("onUpdated", () => hooks.onUpdated?.(feedback, context));
        return withCors(Response.json(present(feedback, context, canReadAuthorEmail)), corsHeaders);
      } catch (error) {
        if (isStoreNotFound(error)) return errorResponse(404, "Feedback not found", corsHeaders);
        return internalError("update feedback", error, corsHeaders);
      }
    },

    DELETE: async (request: Request): Promise<Response> => {
      const corsHeaders = buildCorsHeaders(request, allowedOrigins);
      const authentication = await authenticate(request, "DELETE", corsHeaders);
      if ("refusal" in authentication) return authentication.refusal;
      const { context } = authentication;

      const body = await readJson(request);
      if (!body) return errorResponse(400, "Invalid JSON", corsHeaders);
      const parsed = feedbackDeleteSchema.safeParse(body);
      if (!parsed.success) {
        return withCors(Response.json({ errors: formatValidationErrors(parsed.error) }, { status: 400 }), corsHeaders);
      }
      const deletion = parsed.data;

      try {
        const target: SitepingDeletionTarget =
          "deleteAll" in deletion
            ? { kind: "project", projectName: deletion.projectName }
            : { kind: "single", id: deletion.id, projectName: deletion.projectName };
        const refusal = await authorize(
          target.kind === "project"
            ? { ...context, action: "deleteAll", projectName: target.projectName }
            : { ...context, action: "delete", projectName: target.projectName, feedbackId: target.id },
          corsHeaders,
        );
        if (refusal) return refusal;

        if (
          target.kind === "single" &&
          store.verifyProjectOwnership &&
          !(await store.verifyProjectOwnership(target.id, target.projectName))
        ) {
          return errorResponse(404, "Feedback not found", corsHeaders);
        }

        if (hooks?.onDeleting) {
          try {
            await hooks.onDeleting(target, context);
          } catch (error) {
            logger.error("[siteping] createSitepingHandler: hook onDeleting aborted the deletion", { error, target });
            return errorResponse(502, "Deletion aborted: a linked resource could not be cleaned up", corsHeaders);
          }
        }

        if (target.kind === "project") await store.deleteAllFeedbacks(target.projectName);
        else await store.deleteFeedback(target.id);

        if (hooks?.onDeleted) await runHook("onDeleted", () => hooks.onDeleted?.(target, context));
        return withCors(Response.json({ deleted: true }), corsHeaders);
      } catch (error) {
        if (isStoreNotFound(error)) return errorResponse(404, "Feedback not found", corsHeaders);
        return internalError("delete feedback", error, corsHeaders);
      }
    },
  };
}
