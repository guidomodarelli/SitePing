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

/** `%search%` with LIKE wildcards escaped, so the search matches literally. */
export function toContainsPattern(search: string): string {
  const escaped = search.replace(LIKE_SPECIAL_CHARACTERS, (character) => `${LIKE_ESCAPE_CHARACTER}${character}`);
  return `%${escaped}%`;
}

/**
 * WHERE clause of `getFeedbacks`, built only from dialect-agnostic Drizzle
 * operators; the dialect supplies its columns and case-insensitive LIKE operator.
 */
export function buildFeedbackWhere(
  columns: FeedbackFilterColumns,
  filter: FeedbackFilter,
  likeOperator: CaseInsensitiveLikeOperator,
): SQL | undefined {
  const conditions: SQL[] = [eq(columns.projectName, filter.projectName)];
  if (filter.type) conditions.push(eq(columns.type, filter.type));
  if (filter.statuses) conditions.push(inArray(columns.status, [...filter.statuses]));
  if (filter.url) conditions.push(eq(columns.url, filter.url));
  if (filter.urlPattern) conditions.push(eq(columns.urlPattern, filter.urlPattern));
  if (filter.search) {
    conditions.push(
      sql`${columns.message} ${sql.raw(likeOperator)} ${toContainsPattern(filter.search)} ESCAPE ${LIKE_ESCAPE_CHARACTER}`,
    );
  }
  return and(...conditions);
}
