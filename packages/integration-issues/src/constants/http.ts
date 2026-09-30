/** Per-request timeout for tracker APIs, in milliseconds. */
export const TRACKER_REQUEST_TIMEOUT_MS = 5_000;

/** Upper bound of pages scanned when resolving issue references, to cap API usage. */
export const TRACKER_MAX_LISTED_PAGES = 10;

/** Tracker API answer for a missing resource (e.g. a label that does not exist yet). */
export const HTTP_STATUS_NOT_FOUND = 404;

/** Tracker API answer for a rejected write (e.g. creating a label that already exists). */
export const HTTP_STATUS_UNPROCESSABLE_ENTITY = 422;
