import { CORS_ALLOWED_HEADERS, CORS_ALLOWED_METHODS, CORS_MAX_AGE_SECONDS } from "./constants/http.js";

export type CorsHeaders = Readonly<Record<string, string>>;

/**
 * CORS headers for `request`: only origins listed in `allowedOrigins` are
 * reflected; without the option no CORS headers are emitted (no permissive
 * wildcard by default).
 */
export function buildCorsHeaders(request: Request, allowedOrigins: ReadonlyArray<string> | undefined): CorsHeaders {
  if (!allowedOrigins) return {};
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
    Vary: "Origin",
  };
}

/** Attach CORS headers to an existing Response. */
export function withCors(response: Response, corsHeaders: CorsHeaders): Response {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
