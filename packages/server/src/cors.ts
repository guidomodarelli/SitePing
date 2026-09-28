import { SITEPING_CONFIGURATION_ERROR_MESSAGES } from "./constants/error-messages.js";
import { CORS_DEFAULT_ALLOWED_HEADERS, CORS_MAX_AGE_SECONDS, HTTP_HEADER_NAME_PATTERN } from "./constants/http.js";
import { MAX_REPORTED_HEADER_NAME_LENGTH } from "./constants/limits.js";

export type CorsHeaders = Readonly<Record<string, string>>;

/**
 * Resolved CORS configuration of one endpoint, built once at startup by
 * `createCorsPolicy` so requests never re-validate it.
 */
export interface CorsPolicy {
  /** Exact-match origin allowlist; `undefined` disables CORS headers entirely. */
  readonly allowedOrigins: ReadonlyArray<string> | undefined;
  /** `Access-Control-Allow-Methods` value. */
  readonly allowedMethods: string;
  /** `Access-Control-Allow-Headers` value — defaults plus the configured extras. */
  readonly allowedHeaders: string;
}

/** CORS options an endpoint factory receives from its caller. */
export interface CorsPolicyOptions {
  allowedOrigins: ReadonlyArray<string> | undefined;
  /** Extra request headers to allow on top of `CORS_DEFAULT_ALLOWED_HEADERS`. */
  allowedHeaders: ReadonlyArray<string> | undefined;
  /** Methods this endpoint serves, announced to preflights. */
  allowedMethods: string;
}

/**
 * Merge `extraHeaders` into the default allowlist, case-insensitively and
 * without duplicates (the first spelling wins).
 *
 * @throws Error when an entry is not a valid HTTP header name — a comma or
 * space would otherwise smuggle arbitrary values into the response header.
 */
export function resolveAllowedHeaders(extraHeaders: ReadonlyArray<string> | undefined): string {
  const headersByLowercaseName = new Map<string, string>();
  for (const header of [...CORS_DEFAULT_ALLOWED_HEADERS, ...(extraHeaders ?? [])]) {
    if (typeof header !== "string" || !HTTP_HEADER_NAME_PATTERN.test(header)) {
      const reported = String(header).slice(0, MAX_REPORTED_HEADER_NAME_LENGTH);
      throw new Error(`${SITEPING_CONFIGURATION_ERROR_MESSAGES.invalidAllowedHeader} ${JSON.stringify(reported)}`);
    }
    const lowercaseName = header.toLowerCase();
    if (!headersByLowercaseName.has(lowercaseName)) headersByLowercaseName.set(lowercaseName, header);
  }
  return [...headersByLowercaseName.values()].join(", ");
}

/**
 * Build the CORS policy of an endpoint. The allowed headers are a fixed,
 * validated list: the request's `Access-Control-Request-Headers` is never
 * reflected, so only headers the integrator declared can be preflighted.
 *
 * @throws Error when `allowedHeaders` contains an invalid header name.
 */
export function createCorsPolicy({ allowedOrigins, allowedHeaders, allowedMethods }: CorsPolicyOptions): CorsPolicy {
  return { allowedOrigins, allowedMethods, allowedHeaders: resolveAllowedHeaders(allowedHeaders) };
}

/**
 * CORS headers for `request`: only origins listed in `policy.allowedOrigins`
 * are reflected; without the option no CORS headers are emitted (no
 * permissive wildcard by default).
 */
export function buildCorsHeaders(request: Request, policy: CorsPolicy): CorsHeaders {
  if (!policy.allowedOrigins) return {};
  const origin = request.headers.get("Origin");
  if (!origin || !policy.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": policy.allowedMethods,
    "Access-Control-Allow-Headers": policy.allowedHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
    Vary: "Origin",
  };
}

/** `204` answer to a CORS preflight (`OPTIONS`), with the policy's headers for allowed origins. */
export function preflightResponse(request: Request, policy: CorsPolicy): Response {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request, policy) });
}

/** Attach CORS headers to an existing Response. */
export function withCors(response: Response, corsHeaders: CorsHeaders): Response {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
