import { and, count, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { CASE_INSENSITIVE_LIKE_OPERATOR } from "../constants/search.js";
import { GREATEST_VALUE_FUNCTION } from "../constants/sql.js";
import { guardedCommentInsert } from "../shared/comments.js";
import { deletedFeedbackColumns, toDeletedFeedbacks } from "../shared/deletes.js";
import { feedbackRecordColumns, newestFeedbackFirst } from "../shared/feedbacks.js";
import { buildFeedbackWhere, withSearchableMessage } from "../shared/filters.js";
import type { BeezpingSqlGateway, FeedbackFilter } from "../shared/gateway.js";
import { recordColumns, selectValues } from "../shared/rows.js";
import { monotonicUpdatedAt } from "../shared/timestamps.js";
import type { BeezpingSqliteTables } from "./tables.js";

/** Any Drizzle libSQL database — Turso (remote / embedded replica) or a local libSQL/SQLite file. */
// biome-ignore lint/suspicious/noExplicitAny: accepts every schema generic.
export type AnyLibSQLDatabase = LibSQLDatabase<any>;

/** The libSQL SQL behind `createLibSQLBeezpingStore`. */
export function createLibSQLGateway(
  db: AnyLibSQLDatabase,
  { beezpingFeedbacks, beezpingAnnotations, beezpingComments }: BeezpingSqliteTables,
): BeezpingSqlGateway {
  const whereClause = (filter: FeedbackFilter) =>
    buildFeedbackWhere(beezpingFeedbacks, filter, CASE_INSENSITIVE_LIKE_OPERATOR.sqlite);
  const feedbackColumns = feedbackRecordColumns(getTableColumns(beezpingFeedbacks));
  const commentColumns = recordColumns(getTableColumns(beezpingComments));
  /** Number of feedback rows matching a where clause — the page `total`. */
  const countMatching = async (where: ReturnType<typeof whereClause>): Promise<number> => {
    const [totals] = await db.select({ total: count() }).from(beezpingFeedbacks).where(where);
    return totals?.total ?? 0;
  };
  // SQLite's implicit rowid is the insertion ordinal: the database assigns it on
  // every insert — the store's, or the host application's through the exported
  // table — under its single-writer lock, above every existing row's rowid
  // (without AUTOINCREMENT a deleted maximum may be reused, which still ranks
  // the new row after every row that remains).
  const insertionOrder = sql`${beezpingFeedbacks}.rowid`;

  // Multi-statement writes go through `db.batch`, never an interactive
  // `db.transaction`: libSQL runs a batch as one transaction without yielding
  // between its statements, so no write lock is held across an `await` and
  // the host application's own writes on the same database never hit
  // SQLITE_BUSY because of the store.
  return {
    async insertFeedback(feedback, annotations) {
      const insertFeedbackRow = db
        .insert(beezpingFeedbacks)
        .values(withSearchableMessage(feedback))
        .onConflictDoNothing({ target: beezpingFeedbacks.clientId })
        .returning({ id: beezpingFeedbacks.id });
      if (annotations.length === 0) return (await insertFeedbackRow).length > 0;

      // The feedback id is fresh, so it exists only when this batch inserted it.
      const [inserted] = await db.batch([
        insertFeedbackRow,
        db.insert(beezpingAnnotations).select(
          selectValues(
            beezpingAnnotations,
            annotations.map((annotation, position) => ({ ...annotation, position })),
            sql`EXISTS (SELECT 1 FROM ${beezpingFeedbacks} WHERE ${beezpingFeedbacks.id} = ${feedback.id})`,
          ),
        ),
      ]);
      return inserted.length > 0;
    },
    async findFeedbacks(filter, { limit, offset }) {
      const where = whereClause(filter);
      const [rows, total] = await Promise.all([
        db
          .select(feedbackColumns)
          .from(beezpingFeedbacks)
          .where(where)
          .orderBy(...newestFeedbackFirst(beezpingFeedbacks.createdAt, insertionOrder))
          .limit(limit)
          .offset(offset),
        countMatching(where),
      ]);
      return { rows, total };
    },
    async countFeedbacks(filter) {
      return countMatching(whereClause(filter));
    },
    async findAnnotations(feedbackIds) {
      return db
        .select(recordColumns(getTableColumns(beezpingAnnotations)))
        .from(beezpingAnnotations)
        .where(inArray(beezpingAnnotations.feedbackId, [...feedbackIds]))
        .orderBy(beezpingAnnotations.createdAt, beezpingAnnotations.position);
    },
    async findComments(feedbackIds) {
      return db
        .select(commentColumns)
        .from(beezpingComments)
        .where(inArray(beezpingComments.feedbackId, [...feedbackIds]))
        .orderBy(beezpingComments.createdAt, beezpingComments.position);
    },
    async findCommentByClientId(clientId) {
      const [row] = await db
        .select(commentColumns)
        .from(beezpingComments)
        .where(eq(beezpingComments.clientId, clientId))
        .limit(1);
      return row ?? null;
    },
    async insertComment(comment, maxComments) {
      const { values, condition } = guardedCommentInsert(
        { feedbacks: beezpingFeedbacks, comments: beezpingComments },
        comment,
        maxComments,
      );
      const inserted = await db
        .insert(beezpingComments)
        .select(selectValues(beezpingComments, [values], condition))
        .onConflictDoNothing({ target: beezpingComments.clientId })
        .returning({ id: beezpingComments.id });
      return inserted.length > 0;
    },
    async deleteComment(feedbackId, commentId) {
      const deleted = await db
        .delete(beezpingComments)
        .where(and(eq(beezpingComments.id, commentId), eq(beezpingComments.feedbackId, feedbackId)))
        .returning({ id: beezpingComments.id });
      return deleted.length > 0;
    },
    async findByClientId(clientId) {
      const [row] = await db
        .select(feedbackColumns)
        .from(beezpingFeedbacks)
        .where(eq(beezpingFeedbacks.clientId, clientId))
        .limit(1);
      return row ?? null;
    },
    async findProjectName(id) {
      const [row] = await db
        .select({ projectName: beezpingFeedbacks.projectName })
        .from(beezpingFeedbacks)
        .where(eq(beezpingFeedbacks.id, id))
        .limit(1);
      return row?.projectName ?? null;
    },
    async updateStatus(id, { status, resolvedAt, updatedAt }) {
      const [row] = await db
        .update(beezpingFeedbacks)
        .set({
          status,
          resolvedAt,
          updatedAt: monotonicUpdatedAt(beezpingFeedbacks, updatedAt, GREATEST_VALUE_FUNCTION.sqlite),
        })
        .where(eq(beezpingFeedbacks.id, id))
        .returning(feedbackColumns);
      return row ?? null;
    },
    async deleteById(id, options) {
      // Annotations and comments cascade only with `PRAGMA foreign_keys = ON`,
      // which libSQL does not guarantee — delete them explicitly in the same batch.
      const [, , deleted] = await db.batch([
        db.delete(beezpingAnnotations).where(eq(beezpingAnnotations.feedbackId, id)),
        db.delete(beezpingComments).where(eq(beezpingComments.feedbackId, id)),
        db
          .delete(beezpingFeedbacks)
          .where(eq(beezpingFeedbacks.id, id))
          .returning(deletedFeedbackColumns(beezpingFeedbacks, options)),
      ]);
      return deleted.length > 0 ? toDeletedFeedbacks(deleted) : null;
    },
    async deleteByProject(projectName) {
      const projectFeedbackIds = db
        .select({ id: beezpingFeedbacks.id })
        .from(beezpingFeedbacks)
        .where(eq(beezpingFeedbacks.projectName, projectName));
      await db.batch([
        db.delete(beezpingAnnotations).where(inArray(beezpingAnnotations.feedbackId, projectFeedbackIds)),
        db.delete(beezpingComments).where(inArray(beezpingComments.feedbackId, projectFeedbackIds)),
        db.delete(beezpingFeedbacks).where(eq(beezpingFeedbacks.projectName, projectName)),
      ]);
    },
    async deleteProjectChunk(projectName, chunkSize) {
      // Ordered by the primary key, every statement of the batch picks the same
      // rows: nothing else writes the feedback table between them.
      const chunkIds = db
        .select({ id: beezpingFeedbacks.id })
        .from(beezpingFeedbacks)
        .where(eq(beezpingFeedbacks.projectName, projectName))
        .orderBy(beezpingFeedbacks.id)
        .limit(chunkSize);
      const [, , deleted] = await db.batch([
        db.delete(beezpingAnnotations).where(inArray(beezpingAnnotations.feedbackId, chunkIds)),
        db.delete(beezpingComments).where(inArray(beezpingComments.feedbackId, chunkIds)),
        db
          .delete(beezpingFeedbacks)
          .where(inArray(beezpingFeedbacks.id, chunkIds))
          .returning(deletedFeedbackColumns(beezpingFeedbacks, { collectScreenshotUrls: true })),
      ]);
      return toDeletedFeedbacks(deleted);
    },
    async findReferencedScreenshotUrls(screenshotUrls) {
      const rows = await db
        .selectDistinct({ screenshotUrl: beezpingFeedbacks.screenshotUrl })
        .from(beezpingFeedbacks)
        .where(inArray(beezpingFeedbacks.screenshotUrl, [...screenshotUrls]));
      return new Set(rows.flatMap((row) => (row.screenshotUrl === null ? [] : [row.screenshotUrl])));
    },
  };
}
