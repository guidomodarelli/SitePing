/**
 * `Cache-Control` of the list endpoint under the shared-secret policy —
 * short private cache, the panel refetches often. The response depends only
 * on the request itself (the `Authorization` key), never on a session.
 */
export const LIST_CACHE_CONTROL = "private, max-age=5";

/**
 * `Cache-Control` of the list endpoint under a custom `access` policy: the
 * response depends on the principal (email visibility, `presentFeedback`),
 * often resolved from a cookie the browser cache cannot vary on, so a cached
 * copy could be served to whoever holds the session next.
 */
export const PRINCIPAL_SCOPED_LIST_CACHE_CONTROL = "no-store";

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
