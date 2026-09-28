/** Escape character for LIKE patterns, declared on every search with `ESCAPE`. */
export const LIKE_ESCAPE_CHARACTER = "\\";

/**
 * Characters with a special meaning inside LIKE patterns: the `%` and `_`
 * wildcards plus the escape character itself. Each one is prefixed with
 * {@link LIKE_ESCAPE_CHARACTER} in a single pass, so a literal backslash in the
 * search becomes `\\` and never escapes the character after it (or the
 * trailing `%` of the contains pattern).
 */
export const LIKE_SPECIAL_CHARACTERS = /[\\%_]/g;

/**
 * Substring operator per dialect. PostgreSQL's LIKE is case-sensitive, so it
 * needs ILIKE, which folds case with the database's `LC_CTYPE` (Unicode-aware
 * under a UTF-8 locale). SQLite's LIKE folds only ASCII case, so the libSQL
 * store matches the lowercased search against the `message_search` column,
 * which holds the message already lowercased in JavaScript.
 */
export const CASE_INSENSITIVE_LIKE_OPERATOR = {
  postgres: "ILIKE",
  sqlite: "LIKE",
} as const satisfies Record<string, string>;

export type CaseInsensitiveLikeOperator = "ILIKE" | "LIKE";
