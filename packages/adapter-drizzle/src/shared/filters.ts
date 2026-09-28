import { and, type Column, eq, inArray, type SQL, sql } from "drizzle-orm";
import {
  type CaseInsensitiveLikeOperator,
  LIKE_ESCAPE_CHARACTER,
  LIKE_SPECIAL_CHARACTERS,
} from "../constants/search.js";
import type { FeedbackFilter } from "./gateway.js";

/** Feedback columns the list filters read — satisfied by both dialects' tables. */
export interface FeedbackFilterColumns {
  projectName: Column;
  type: Column;
  status: Column;
  url: Column;
  urlPattern: Column;
  message: Column;
}

/** Builds the condition matching the rows whose message contains `search`, case-insensitively. */
export type MessageSearchCondition = (search: string) => SQL;

/** `%search%` with LIKE wildcards escaped, so the search matches literally. */
export function toContainsPattern(search: string): string {
  const escaped = search.replace(LIKE_SPECIAL_CHARACTERS, (character) => `${LIKE_ESCAPE_CHARACTER}${character}`);
  return `%${escaped}%`;
}

/**
 * Case folding of the text search — the same Unicode-aware `toLowerCase()` the
 * standard store filter (`applyFeedbackFilters` in core) applies to both the
 * message and the search, so a SQL store matches exactly what an in-memory one does.
 *
 * @param text - A message to store in its searchable form, or a search term.
 * @returns The lowercased text.
 */
export function toSearchableText(text: string): string {
  return text.toLowerCase();
}

/**
 * `target <operator> '%search%' ESCAPE '\'` — a literal substring match.
 *
 * @param target - Column or expression searched.
 * @param likeOperator - The dialect's LIKE operator.
 * @param search - The search term, matched literally.
 */
export function containsCondition(
  target: Column | SQL,
  likeOperator: CaseInsensitiveLikeOperator,
  search: string,
): SQL {
  return sql`${target} ${sql.raw(likeOperator)} ${toContainsPattern(search)} ESCAPE ${LIKE_ESCAPE_CHARACTER}`;
}

/**
 * WHERE clause of `getFeedbacks`, built only from dialect-agnostic Drizzle
 * operators; the dialect supplies its columns and how it matches the text search.
 */
export function buildFeedbackWhere(
  columns: FeedbackFilterColumns,
  filter: FeedbackFilter,
  messageSearchCondition: MessageSearchCondition,
): SQL | undefined {
  const conditions: SQL[] = [eq(columns.projectName, filter.projectName)];
  if (filter.type) conditions.push(eq(columns.type, filter.type));
  if (filter.statuses) conditions.push(inArray(columns.status, [...filter.statuses]));
  if (filter.url) conditions.push(eq(columns.url, filter.url));
  if (filter.urlPattern) conditions.push(eq(columns.urlPattern, filter.urlPattern));
  if (filter.search) conditions.push(messageSearchCondition(filter.search));
  return and(...conditions);
}
