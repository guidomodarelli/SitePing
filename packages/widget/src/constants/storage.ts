/** Stores author identity separately from queued and submitted feedback. */
export const IDENTITY_STORAGE_KEY = "beezping_identity";

/** Stores feedback awaiting an HTTP retry. */
export const RETRY_QUEUE_KEY = "beezping_retry_queue";

/** Scopes the browser's own-feedback ids by project and endpoint. */
export const OWN_FEEDBACK_KEY_PREFIX = "beezping_own_feedback:";
