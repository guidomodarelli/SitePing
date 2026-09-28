import { type Column, desc, type SQL } from "drizzle-orm";

/** Feedback columns the "newest first" ordering reads — satisfied by both dialects' tables. */
export interface FeedbackOrderingColumns {
  createdAt: Column;
  creationSequence: Column;
}

/**
 * Internal feedback columns that are never part of the feedback record: the
 * `creationSequence` ordinal (drives the ordering) and the `messageSearch`
 * normalized copy of the message (drives the text search).
 */
export interface InternalFeedbackColumns {
  creationSequence: Column;
  messageSearch: Column;
}

/**
 * The columns a feedback row is read from — every column except the internal
 * ones (`creationSequence`, `messageSearch`).
 *
 * @param columns - `getTableColumns(feedbacksTable)`.
 * @returns The same columns without the internal ones.
 */
export function feedbackRecordColumns<Columns extends InternalFeedbackColumns>(
  columns: Columns,
): Omit<Columns, keyof InternalFeedbackColumns> {
  const { creationSequence: _creationSequence, messageSearch: _messageSearch, ...recordColumns } = columns;
  return recordColumns;
}

/**
 * `ORDER BY` of the feedback list: newest `createdAt` first, ties broken by the
 * database-wide insertion ordinal. `createdAt` is the injected clock
 * value as is, so rows created in the same millisecond — by one store
 * instance or several processes — would otherwise come back in an undefined
 * order, and offset pages would overlap or skip rows.
 *
 * @param columns - Feedback table columns.
 */
export function newestFeedbackFirst(columns: FeedbackOrderingColumns): SQL[] {
  return [desc(columns.createdAt), desc(columns.creationSequence)];
}
