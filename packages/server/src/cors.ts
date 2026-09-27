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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
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
