import { and, type Column, count, eq, getTableColumns, inArray, type SQL, sql, type WithSubquery } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { CASE_INSENSITIVE_LIKE_OPERATOR } from "../constants/search.js";
import {
  GREATEST_VALUE_FUNCTION,
  INSERTED_ANNOTATIONS_CTE_ALIAS,
  INSERTED_FEEDBACK_CTE_ALIAS,
} from "../constants/sql.js";
import { guardedCommentInsert } from "../shared/comments.js";
import { deletedFeedbackColumns, toDeletedFeedbacks } from "../shared/deletes.js";
import { feedbackRecordColumns, newestFeedbackFirst } from "../shared/feedbacks.js";
import { buildFeedbackWhere, withSearchableMessage } from "../shared/filters.js";
import type { BeezpingSqlGateway, FeedbackFilter } from "../shared/gateway.js";
import { recordColumns, selectValues } from "../shared/rows.js";
import { monotonicUpdatedAt } from "../shared/timestamps.js";
import type { BeezpingPgTables } from "./tables.js";

/**
 * Any Drizzle PostgreSQL database — node-postgres, postgres.js, Neon
 * (serverless / HTTP), Vercel Postgres, Supabase, PGlite… The store never
 * opens an interactive `db.transaction`: every write is a single statement,
 * so drivers without interactive transactions (Neon HTTP) work too.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts every driver's query-result HKT and schema.
export type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

/**
 * Type a bound parameter as its target column: parameters inside a `VALUES`
 * list carry no type of their own in PostgreSQL.
 */
function castToColumnType(param: SQL, column: Column): SQL {
  return sql`CAST(${param} AS ${sql.raw(column.getSQLType())})`;
}

/** The PostgreSQL SQL behind `createPgBeezpingStore`. */
export function createPgGateway(
  db: AnyPgDatabase,
  { beezpingFeedbacks, beezpingAnnotations, beezpingComments }: BeezpingPgTables,
): BeezpingSqlGateway {
  const whereClause = (filter: FeedbackFilter) =>
    buildFeedbackWhere(beezpingFeedbacks, filter, CASE_INSENSITIVE_LIKE_OPERATOR.postgres);
  const feedbackColumns = feedbackRecordColumns(getTableColumns(beezpingFeedbacks));
  const commentColumns = recordColumns(getTableColumns(beezpingComments));
  /** Number of feedback rows matching a where clause — the page `total`. */
  const countMatching = async (where: ReturnType<typeof whereClause>): Promise<number> => {
    const [totals] = await db.select({ total: count() }).from(beezpingFeedbacks).where(where);
    return totals?.total ?? 0;
  };

  return {
    /**
     * One statement, no interactive transaction (Neon HTTP has none): the
     * feedback insert is a CTE, and the annotation insert selects from it —
     * so annotations land only with the feedback row, atomically.
     */
    async insertFeedback(feedback, annotations) {
      const insertedFeedback = db
        .$with(INSERTED_FEEDBACK_CTE_ALIAS)
        .as(
          db
            .insert(beezpingFeedbacks)
            .values(withSearchableMessage(feedback))
            .onConflictDoNothing({ target: beezpingFeedbacks.clientId })
            .returning({ id: beezpingFeedbacks.id }),
        );
      const statements: WithSubquery[] = [insertedFeedback];
      if (annotations.length > 0) {
        // Data-modifying CTEs always run to completion, even unreferenced.
        statements.push(
          db.$with(INSERTED_ANNOTATIONS_CTE_ALIAS).as(
            db.insert(beezpingAnnotations).select(
              selectValues(
                beezpingAnnotations,
                annotations.map((annotation, position) => ({ ...annotation, position })),
                sql`EXISTS (SELECT 1 FROM ${insertedFeedback})`,
                castToColumnType,
              ),
            ),
          ),
        );
      }
      const inserted = await db
        .with(...statements)
        .select({ id: insertedFeedback.id })
        .from(insertedFeedback);
      return inserted.length > 0;
    },
    async findFeedbacks(filter, { limit, offset }) {
      const where = whereClause(filter);
      const [rows, total] = await Promise.all([
        db
          .select(feedbackColumns)
          .from(beezpingFeedbacks)
          .where(where)
          .orderBy(...newestFeedbackFirst(beezpingFeedbacks.createdAt, beezpingFeedbacks.creationSequence))
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
        .select(selectValues(beezpingComments, [values], condition, castToColumnType))
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
          updatedAt: monotonicUpdatedAt(beezpingFeedbacks, updatedAt, GREATEST_VALUE_FUNCTION.postgres),
        })
        .where(eq(beezpingFeedbacks.id, id))
        .returning(feedbackColumns);
      return row ?? null;
    },
    async deleteById(id, options) {
      const rows = await db
        .delete(beezpingFeedbacks)
        .where(eq(beezpingFeedbacks.id, id))
        .returning(deletedFeedbackColumns(beezpingFeedbacks, options));
      return rows.length > 0 ? toDeletedFeedbacks(rows) : null;
    },
    // Annotations and comments follow their feedback through the `ON DELETE CASCADE` foreign keys.
    async deleteByProject(projectName) {
      await db.delete(beezpingFeedbacks).where(eq(beezpingFeedbacks.projectName, projectName));
    },
    async deleteProjectChunk(projectName, chunkSize) {
      const chunkIds = db
        .select({ id: beezpingFeedbacks.id })
        .from(beezpingFeedbacks)
        .where(eq(beezpingFeedbacks.projectName, projectName))
        .orderBy(beezpingFeedbacks.id)
        .limit(chunkSize);
      const rows = await db
        .delete(beezpingFeedbacks)
        .where(inArray(beezpingFeedbacks.id, chunkIds))
        .returning(deletedFeedbackColumns(beezpingFeedbacks, { collectScreenshotUrls: true }));
      return toDeletedFeedbacks(rows);
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
