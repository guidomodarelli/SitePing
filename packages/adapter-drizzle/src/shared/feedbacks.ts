import { type Column, desc, type SQL } from "drizzle-orm";

/** Feedback columns the "newest first" ordering reads — satisfied by both dialects' tables. */
export interface FeedbackOrderingColumns {
  createdAt: Column;
  creationSequence: Column;
}

/**
 * The columns a feedback row is read from — every column except the internal
 * `creationSequence` ordinal, which only drives the ordering.
 *
 * @param columns - `getTableColumns(feedbacksTable)`.
 * @returns The same columns without `creationSequence`.
 */
export function feedbackRecordColumns<Columns extends { creationSequence: Column }>(
  columns: Columns,
): Omit<Columns, "creationSequence"> {
  const { creationSequence: _creationSequence, ...recordColumns } = columns;
  return recordColumns;
}

/**
 * `ORDER BY` of the feedback list: newest `createdAt` first, ties broken by the
 * database-wide insertion ordinal. `createdAt` is only issued strictly
 * increasing within one store instance, so rows created in the same
 * millisecond by separate instances or processes would otherwise come back in
 * an undefined order — and offset pages would overlap or skip rows.
 *
 * @param columns - Feedback table columns.
 */
export function newestFeedbackFirst(columns: FeedbackOrderingColumns): SQL[] {
  return [desc(columns.createdAt), desc(columns.creationSequence)];
}
