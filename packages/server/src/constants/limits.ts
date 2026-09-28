/** Most annotations accepted on one feedback (also enforced by the create schema). */
export const MAX_ANNOTATIONS_PER_FEEDBACK = 50;

/** Longest refused `Origin` value written to the log (untrusted input). */
export const MAX_LOGGED_ORIGIN_LENGTH = 128;

/** Longest invalid `allowedHeaders` entry echoed back in a configuration error. */
export const MAX_REPORTED_HEADER_NAME_LENGTH = 64;
