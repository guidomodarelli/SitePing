import type { SitepingHttpMethod } from "./access.js";
import { CSRF_PROTECTED_METHODS, JSON_MEDIA_TYPE } from "./constants/http.js";
import { MAX_LOGGED_ORIGIN_LENGTH } from "./constants/limits.js";
import type { CorsPolicy } from "./cors.js";

/**
 * Cross-site request forgery guards of the mutating methods. CORS only hides
 * a response from a foreign page — it never stops a "simple" request (e.g. a
 * credentialed `POST` with `Content-Type: text/plain`) from reaching the
 * handler, so both checks run before the body is parsed, the caller is
 * authenticated or any hook fires.
 */

/** Whether `method` changes data and therefore goes through the CSRF guards. */
export function isCsrfProtectedMethod(method: SitepingHttpMethod): boolean {
  return CSRF_PROTECTED_METHODS.includes(method);
}

/**
 * Whether the request's `Origin` may mutate data under `policy`.
 *
 * - No `allowedOrigins` → no origin check (the JSON content-type guard still
 *   forces cross-origin browsers through a preflight, which fails without
 *   CORS headers).
 * - No `Origin` header → allowed: server-to-server calls, curl and
 *   same-origin navigations of older browsers do not send one, and a browser
 *   always sends it on cross-origin `POST`/`PATCH`/`DELETE`.
 * - Same origin as the request URL, or listed in `allowedOrigins` → allowed.
 * - Anything else, including the opaque `null` origin → refused.
 */
export function isMutationOriginAllowed(request: Request, policy: CorsPolicy): boolean {
  if (!policy.allowedOrigins) return true;
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  if (policy.allowedOrigins.includes(origin)) return true;
  return origin === new URL(request.url).origin;
}

/** Whether the request declares a JSON body (`application/json`, parameters such as `charset` allowed). */
export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("Content-Type");
  if (contentType === null) return false;
  const [mediaType = ""] = contentType.split(";");
  return mediaType.trim().toLowerCase() === JSON_MEDIA_TYPE;
}

/** The request's `Origin`, truncated and stripped of control characters, safe to log. */
export function describeOriginForLog(request: Request): string {
  const origin = request.headers.get("Origin") ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  return origin.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_LOGGED_ORIGIN_LENGTH);
}
