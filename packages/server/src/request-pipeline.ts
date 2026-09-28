import type { FeedbackRecord } from "@siteping/core";
import type {
  AccessGate,
  AuthenticationOutcome,
  SitepingAuthorizationContext,
  SitepingHttpMethod,
  SitepingRequestContext,
} from "./access.js";
import { SITEPING_ERROR_MESSAGES } from "./constants/error-messages.js";
import { buildCorsHeaders, type CorsHeaders, type CorsPolicy, withCors } from "./cors.js";
import { internalErrorResponse } from "./internal-error.js";
import type { SitepingLogger } from "./options.js";
import { formatValidationErrors } from "./validation.js";

/** A request that passed authentication — what every operation works with. */
export interface AuthenticatedRequest<Principal> {
  context: SitepingRequestContext<Principal>;
  canReadAuthorEmail: boolean;
  corsHeaders: CorsHeaders;
}

/** Either a value to continue with, or the response to send right away. */
export type PipelineStep<Value> = { ok: true; value: Value } | { ok: false; response: Response };

/** Minimal shape of a zod schema the pipeline validates with. */
interface ParseableSchema<Output> {
  safeParse(
    input: unknown,
  ): { success: true; data: Output } | { success: false; error: Parameters<typeof formatValidationErrors>[0] };
}

export interface RequestPipelineDependencies<Principal> {
  gate: AccessGate<Principal>;
  corsPolicy: CorsPolicy;
  logger: SitepingLogger;
  describeError: ((error: unknown) => string | undefined) | undefined;
  presentFeedback:
    | ((feedback: FeedbackRecord, context: SitepingRequestContext<Principal>) => FeedbackRecord)
    | undefined;
}

/**
 * Serialize a record for the wire. `clientId` is always stripped — it is a
 * browser-local dedup secret, and the POST dedup path returns the full
 * record to whoever presents it. `authorEmail` is blanked unless allowed.
 */
function toWireFeedback(feedback: FeedbackRecord, includeEmail: boolean): Omit<FeedbackRecord, "clientId"> {
  const { clientId: _clientId, ...wire } = feedback;
  return includeEmail ? wire : { ...wire, authorEmail: "" };
}

/**
 * The steps every HTTP operation shares — authenticate, parse, authorize,
 * respond, report failures — so each operation module only holds its own
 * logic. Every response carries the request's CORS headers.
 */
export function createRequestPipeline<Principal>({
  gate,
  corsPolicy,
  logger,
  describeError,
  presentFeedback,
}: RequestPipelineDependencies<Principal>) {
  const json = (scope: Pick<AuthenticatedRequest<Principal>, "corsHeaders">, body: unknown, init?: ResponseInit) =>
    withCors(Response.json(body, init), scope.corsHeaders);

  const error = (scope: Pick<AuthenticatedRequest<Principal>, "corsHeaders">, status: number, message: string) =>
    json(scope, { error: message }, { status });

  /** Validate `input` (a parsed body or query) against `schema`. */
  const validate = <Output>(
    scope: AuthenticatedRequest<Principal>,
    schema: ParseableSchema<Output>,
    input: unknown,
  ): PipelineStep<Output> => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, response: json(scope, { errors: formatValidationErrors(parsed.error) }, { status: 400 }) };
  };

  /** Log an unexpected failure and answer 500 (with `describeError`'s hint when it has one). */
  const internalError = (request: Request, corsHeaders: CorsHeaders, operation: string, failure: unknown): Response =>
    internalErrorResponse({
      logger,
      describeError,
      source: "createSitepingHandler",
      operation,
      request,
      corsHeaders,
      failure,
    });

  return {
    json,
    error,

    /**
     * Run the access gate. A throwing `authenticate` (session store down…)
     * answers the logged 500 with CORS headers instead of rejecting the
     * handler, which a browser would only see as an opaque network error.
     */
    async authenticate(
      request: Request,
      method: SitepingHttpMethod,
    ): Promise<PipelineStep<AuthenticatedRequest<Principal>>> {
      const corsHeaders = buildCorsHeaders(request, corsPolicy);
      let outcome: AuthenticationOutcome<Principal>;
      try {
        outcome = await gate.authenticate(request, method);
      } catch (failure) {
        return { ok: false, response: internalError(request, corsHeaders, "authenticate request", failure) };
      }
      if (!outcome.ok) return { ok: false, response: error({ corsHeaders }, outcome.status, outcome.error) };
      return {
        ok: true,
        value: {
          context: { request, principal: outcome.principal },
          canReadAuthorEmail: outcome.canReadAuthorEmail,
          corsHeaders,
        },
      };
    },

    validate,

    /** Read and validate a JSON body. */
    async readBody<Output>(
      scope: AuthenticatedRequest<Principal>,
      schema: ParseableSchema<Output>,
    ): Promise<PipelineStep<Output>> {
      const body: unknown = await scope.context.request.json().catch(() => null);
      if (!body) return { ok: false, response: error(scope, 400, SITEPING_ERROR_MESSAGES.invalidJson) };
      return validate(scope, schema, body);
    },

    /** `null` when allowed, the 403 response otherwise. */
    async authorize(
      scope: AuthenticatedRequest<Principal>,
      authorization: Omit<SitepingAuthorizationContext<Principal>, keyof SitepingRequestContext<Principal>>,
    ): Promise<Response | null> {
      const allowed = await gate.authorize({ ...scope.context, ...authorization });
      return allowed ? null : error(scope, 403, SITEPING_ERROR_MESSAGES.forbidden);
    },

    /** Wire shape of a record for this requester (presentFeedback + email policy). */
    present(scope: AuthenticatedRequest<Principal>, feedback: FeedbackRecord, includeEmail = scope.canReadAuthorEmail) {
      return toWireFeedback(presentFeedback ? presentFeedback(feedback, scope.context) : feedback, includeEmail);
    },

    /** Log an unexpected failure and answer 500 (with `describeError`'s hint when it has one). */
    internalError(scope: AuthenticatedRequest<Principal>, operation: string, failure: unknown): Response {
      return internalError(scope.context.request, scope.corsHeaders, operation, failure);
    },

    /** Run a post-write hook; its failure is logged, never surfaced. */
    async runHook(name: string, invoke: () => void | Promise<void>): Promise<void> {
      try {
        await invoke();
      } catch (failure) {
        logger.error(`[siteping] createSitepingHandler: hook ${name} failed`, { error: failure });
      }
    },

    logger,

    /** `Cache-Control` of list responses, as the access policy allows. */
    listCacheControl: gate.listCacheControl,
  };
}

export type RequestPipeline<Principal> = ReturnType<typeof createRequestPipeline<Principal>>;
