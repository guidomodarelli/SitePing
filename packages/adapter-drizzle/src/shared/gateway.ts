import type { AnnotationRecord, FeedbackQuery, FeedbackRecord, FeedbackStatus } from "@siteping/core";

/** A stored feedback row — the record without its annotations relation. */
export type FeedbackRow = Omit<FeedbackRecord, "annotations">;

/** A stored annotation row — identical to the record. */
export type AnnotationRow = AnnotationRecord;

/** Filters of `getFeedbacks`, already normalized (bucket vs exact status resolved). */
export interface FeedbackFilter {
  projectName: string;
  type?: FeedbackQuery["type"];
  statuses?: readonly FeedbackStatus[];
  url?: string;
  urlPattern?: string;
  search?: string;
}

/**
 * The dialect-specific SQL a Drizzle-backed store needs. Each dialect entry
 * (`./pg`, `./libsql`) implements it with its own tables and query builder;
 * `DrizzleSitepingStore` owns every contract semantic on top of it.
 * @internal
 */
export interface SitepingSqlGateway {
  /**
   * Insert the feedback and its annotations atomically. Returns `false`
   * without writing when a row with the same `clientId` already exists.
   */
  insertFeedback(feedback: FeedbackRow, annotations: readonly AnnotationRow[]): Promise<boolean>;
  findFeedbacks(
    filter: FeedbackFilter,
    page: { limit: number; offset: number },
  ): Promise<{ rows: FeedbackRow[]; total: number }>;
  findAnnotations(feedbackIds: readonly string[]): Promise<AnnotationRow[]>;
  findByClientId(clientId: string): Promise<FeedbackRow | null>;
  findById(id: string): Promise<FeedbackRow | null>;
  updateStatus(
    id: string,
    update: { status: FeedbackStatus; resolvedAt: Date | null; updatedAt: Date },
  ): Promise<FeedbackRow | null>;
  /** Delete one row (annotations cascade); returns the deleted row, or `null` when missing. */
  deleteById(id: string): Promise<FeedbackRow | null>;
  /** Delete every row of a project; returns their stored screenshot URLs. */
  deleteByProject(projectName: string): Promise<Array<string | null>>;
}

/** Escape LIKE wildcards so `search` matches literally (used with `ESCAPE '\'`). */
export function toContainsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
