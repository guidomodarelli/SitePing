/** Escape character for LIKE patterns, declared on every search with `ESCAPE`. */
export const LIKE_ESCAPE_CHARACTER = "\\";

/** Characters with a special meaning inside LIKE patterns (the escape character included). */
export const LIKE_SPECIAL_CHARACTERS = /[%_]/g;

/**
 * Case-insensitive substring operator per dialect. PostgreSQL's LIKE is
 * case-sensitive, so it needs ILIKE; SQLite's LIKE already ignores ASCII case.
 */
export const CASE_INSENSITIVE_LIKE_OPERATOR = {
  postgres: "ILIKE",
  sqlite: "LIKE",
} as const satisfies Record<string, string>;

export type CaseInsensitiveLikeOperator = "ILIKE" | "LIKE";
