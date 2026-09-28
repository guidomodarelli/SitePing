/**
 * `Cache-Control` of the list endpoint, whatever the access policy. The
 * response depends on the caller's credentials — the `Authorization` key
 * (authentication, `authorEmail` redaction) or a session cookie (principal,
 * `presentFeedback`) — none of which the browser cache varies on, so a
 * cached copy could be replayed to a request that lost those credentials.
 */
export const LIST_CACHE_CONTROL = "no-store";

/** `Cache-Control` of the identity endpoint — depends on the session, never cached. */
export const IDENTITY_CACHE_CONTROL = "no-store";

/** Methods announced in CORS preflight responses of the feedback endpoint. */
export const CORS_ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

/** Methods announced in CORS preflight responses of the identity endpoint. */
export const IDENTITY_CORS_ALLOWED_METHODS = "GET, OPTIONS";

/**
 * Request headers the widget sends cross-origin — always allowed. The
 * `allowedHeaders` option extends this list (e.g. a custom session header
 * read by `access.authenticate`), never replaces it.
 */
export const CORS_DEFAULT_ALLOWED_HEADERS: ReadonlyArray<string> = ["Content-Type", "Authorization"];

/**
 * Valid HTTP header field name (RFC 9110 `token`). Guards `allowedHeaders`
 * so a typo cannot inject separators into `Access-Control-Allow-Headers`.
 */
export const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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
