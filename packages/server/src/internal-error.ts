import { SITEPING_ERROR_MESSAGES } from "./constants/error-messages.js";
import { type CorsHeaders, withCors } from "./cors.js";
import type { SitepingLogger } from "./options.js";

/** Logs to `console.error` — the logger of handlers created without one. */
export const defaultLogger: SitepingLogger = {
  error(message, context) {
    console.error(message, context);
  },
};

/** Everything needed to report one unexpected failure of a request. */
export interface InternalErrorReport {
  logger: SitepingLogger;
  /** Optional safe hint returned to the caller instead of the generic message. */
  describeError?: ((error: unknown) => string | undefined) | undefined;
  /** Factory the failure happened in, e.g. `createSitepingHandler`. */
  source: string;
  /** What was running, e.g. `create feedback` or `authenticate request`. */
  operation: string;
  request: Request;
  corsHeaders: CorsHeaders;
  /** Extra response headers (e.g. `Cache-Control`). */
  headers?: HeadersInit | undefined;
  failure: unknown;
}

/**
 * Log an unexpected failure with its request context (operation, method,
 * path — never the query, headers or body) and the original error, then
 * answer a JSON 500 carrying the request's CORS headers. The body holds the
 * generic message unless `describeError` supplies a safe hint, so the
 * failure's own details never reach the caller.
 */
export function internalErrorResponse({
  logger,
  describeError,
  source,
  operation,
  request,
  corsHeaders,
  headers,
  failure,
}: InternalErrorReport): Response {
  logger.error(`[siteping] ${source}: ${operation} failed`, {
    error: failure,
    method: request.method,
    path: new URL(request.url).pathname,
  });
  const message = describeError?.(failure) ?? SITEPING_ERROR_MESSAGES.internalServerError;
  return withCors(Response.json({ error: message }, { status: 500, ...(headers ? { headers } : {}) }), corsHeaders);
}
