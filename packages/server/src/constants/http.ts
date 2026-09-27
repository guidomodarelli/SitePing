/** `Cache-Control` of the list endpoint — short private cache, the panel refetches often. */
export const LIST_CACHE_CONTROL = "private, max-age=5";

/** `Cache-Control` of the identity endpoint — depends on the session, never cached. */
export const IDENTITY_CACHE_CONTROL = "no-store";

/** Methods announced in CORS preflight responses. */
export const CORS_ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

/** Request headers the widget sends cross-origin. */
export const CORS_ALLOWED_HEADERS = "Content-Type, Authorization";

/** How long browsers may cache a preflight answer, in seconds (24 h). */
export const CORS_MAX_AGE_SECONDS = 86_400;

/** Query parameters the list endpoint reads (everything else is ignored). */
export const LIST_QUERY_KEYS = [
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
