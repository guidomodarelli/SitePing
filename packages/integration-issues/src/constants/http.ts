/** Per-request timeout for tracker APIs, in milliseconds. */
export const TRACKER_REQUEST_TIMEOUT_MS = 5_000;

/** Number of the first page in the tracker APIs' page-number pagination. */
export const TRACKER_FIRST_PAGE_NUMBER = 1;

/** Tracker API answer for a missing resource (e.g. a label that does not exist yet). */
export const HTTP_STATUS_NOT_FOUND = 404;

/** Tracker API answer for a rejected write (e.g. creating a label that already exists). */
export const HTTP_STATUS_UNPROCESSABLE_ENTITY = 422;
