import { type AccessGate, accessGateFromControl } from "./access.js";
import { createApiKeyGate } from "./api-key-access.js";
import { SITEPING_CONFIGURATION_ERROR_MESSAGES } from "./constants/error-messages.js";
import { CORS_ALLOWED_METHODS } from "./constants/http.js";
import { createCorsPolicy, preflightResponse } from "./cors.js";
import { defaultLogger } from "./internal-error.js";
import { createFeedbackOperation } from "./operations/create-feedback.js";
import { deleteFeedbackOperation } from "./operations/delete-feedback.js";
import { listFeedbacksOperation } from "./operations/list-feedbacks.js";
import { updateFeedbackOperation } from "./operations/update-feedback.js";
import type {
  SitepingAccessHandlerOptions,
  SitepingApiKeyHandlerOptions,
  SitepingHandler,
  SitepingHandlerBaseOptions,
  SitepingHandlerOptions,
} from "./options.js";
import { createRequestPipeline } from "./request-pipeline.js";
import type { WebhookConfig } from "./webhooks.js";

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
 * @throws Error when `allowedHeaders` contains an invalid header name.
 * @throws Error when `access.authorize` is set and the store lacks
 * `verifyProjectOwnership` — per-record PATCH/DELETE could otherwise target
 * a record of a project the caller is not authorized for.
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
    allowedHeaders,
    beforeCreate,
    presentFeedback,
    hooks = {},
    logger = defaultLogger,
    describeError,
  } = options as SitepingHandlerBaseOptions<Principal>;
  if (!store) {
    throw new Error("[siteping] createSitepingHandler requires a `store`.");
  }
  // A custom `authorize` may scope principals to projects, but PATCH/DELETE
  // address records by id: without an ownership check, the project a caller
  // claims (and is authorized for) need not be the record's. Fail closed at
  // startup rather than letting per-record mutations cross projects.
  if (options.access?.authorize && !store.verifyProjectOwnership) {
    throw new Error(SITEPING_CONFIGURATION_ERROR_MESSAGES.ownershipVerificationRequired);
  }
  const corsPolicy = createCorsPolicy({ allowedOrigins, allowedHeaders, allowedMethods: CORS_ALLOWED_METHODS });
  const gate: AccessGate<Principal> = options.access
    ? accessGateFromControl(options.access)
    : (createApiKeyGate(options) as AccessGate<Principal>);
  const pipeline = createRequestPipeline<Principal>({ gate, corsPolicy, logger, describeError, presentFeedback });

  return {
    /** CORS preflight. Configure `allowedOrigins` (and `allowedHeaders`) for cross-origin widgets. */
    OPTIONS: (request: Request): Response => preflightResponse(request, corsPolicy),
    POST: createFeedbackOperation({
      store,
      pipeline,
      beforeCreate,
      onCreated: hooks.onCreated?.bind(hooks),
      webhooks: toWebhookList(options.webhooks),
    }),
    GET: listFeedbacksOperation({ store, pipeline }),
    PATCH: updateFeedbackOperation({ store, pipeline, onUpdated: hooks.onUpdated?.bind(hooks) }),
    DELETE: deleteFeedbackOperation({
      store,
      pipeline,
      onDeleting: hooks.onDeleting?.bind(hooks),
      onDeleted: hooks.onDeleted?.bind(hooks),
    }),
  };
}
