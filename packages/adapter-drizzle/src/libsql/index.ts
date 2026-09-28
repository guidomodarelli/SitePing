import { count, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { CASE_INSENSITIVE_LIKE_OPERATOR } from "../constants/search.js";
import { GREATEST_VALUE_FUNCTION } from "../constants/sql.js";
import { annotationRecordColumns, selectAnnotationValues } from "../shared/annotations.js";
import { deletedFeedbackColumns, toDeletedFeedbacks } from "../shared/deletes.js";
import { feedbackRecordColumns, newestFeedbackFirst } from "../shared/feedbacks.js";
import { buildFeedbackWhere } from "../shared/filters.js";
import type { FeedbackFilter, SitepingSqlGateway } from "../shared/gateway.js";
import { DrizzleSitepingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { monotonicUpdatedAt } from "../shared/timestamps.js";
import { createSitepingSqliteTables, type SitepingSqliteTables } from "./tables.js";

export type { FeedbackRecord, ScreenshotStorage, SitepingStore } from "@siteping/core";
export { isStorePersistence, StoreDuplicateError, StoreNotFoundError, StorePersistenceError } from "@siteping/core";
export { DEFAULT_SITEPING_TABLE_NAMES, type SitepingTableNames } from "../constants/table-names.js";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "../shared/store.js";
export { createSitepingSqliteTables, type SitepingSqliteTables } from "./tables.js";

/** Any Drizzle libSQL database — Turso (remote / embedded replica) or a local libSQL/SQLite file. */
// biome-ignore lint/suspicious/noExplicitAny: accepts every schema generic.
export type AnyLibSQLDatabase = LibSQLDatabase<any>;

export interface LibSQLSitepingStoreOptions extends DrizzleStoreOptions {
  /** Tables built with `createSitepingSqliteTables` — pass them when you customized the names. */
  tables?: SitepingSqliteTables;
}

function createLibSQLGateway(
  db: AnyLibSQLDatabase,
  { sitepingFeedbacks, sitepingAnnotations }: SitepingSqliteTables,
): SitepingSqlGateway {
  const whereClause = (filter: FeedbackFilter) =>
    buildFeedbackWhere(sitepingFeedbacks, filter, CASE_INSENSITIVE_LIKE_OPERATOR.sqlite);
  const recordColumns = feedbackRecordColumns(getTableColumns(sitepingFeedbacks));
  // Evaluated inside the insert statement: SQLite runs one writer at a time,
  // so concurrent inserts — from any process — never read the same maximum.
  const nextCreationSequence = sql<number>`(SELECT COALESCE(MAX(${sitepingFeedbacks.creationSequence}), 0) + 1 FROM ${sitepingFeedbacks})`;

  // Multi-statement writes go through `db.batch`, never an interactive
  // `db.transaction`: libSQL runs a batch as one transaction without yielding
  // between its statements, so no write lock is held across an `await` and
  // the host application's own writes on the same database never hit
  // SQLITE_BUSY because of the store.
  return {
    async insertFeedback(feedback, annotations) {
      const insertFeedbackRow = db
        .insert(sitepingFeedbacks)
        .values({ ...feedback, creationSequence: nextCreationSequence })
        .onConflictDoNothing({ target: sitepingFeedbacks.clientId })
        .returning({ id: sitepingFeedbacks.id });
      if (annotations.length === 0) return (await insertFeedbackRow).length > 0;

      // The feedback id is fresh, so it exists only when this batch inserted it.
      const [inserted] = await db.batch([
        insertFeedbackRow,
        db
          .insert(sitepingAnnotations)
          .select(
            selectAnnotationValues(
              sitepingAnnotations,
              annotations,
              sql`EXISTS (SELECT 1 FROM ${sitepingFeedbacks} WHERE ${sitepingFeedbacks.id} = ${feedback.id})`,
            ),
          ),
      ]);
      return inserted.length > 0;
    },
    async findFeedbacks(filter, { limit, offset }) {
      const where = whereClause(filter);
      const [rows, totals] = await Promise.all([
        db
          .select(recordColumns)
          .from(sitepingFeedbacks)
          .where(where)
          .orderBy(...newestFeedbackFirst(sitepingFeedbacks))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(sitepingFeedbacks).where(where),
      ]);
      return { rows, total: totals[0]?.total ?? 0 };
    },
    async findAnnotations(feedbackIds) {
      return db
        .select(annotationRecordColumns(getTableColumns(sitepingAnnotations)))
        .from(sitepingAnnotations)
        .where(inArray(sitepingAnnotations.feedbackId, [...feedbackIds]))
        .orderBy(sitepingAnnotations.createdAt, sitepingAnnotations.position);
    },
    async findByClientId(clientId) {
      const [row] = await db
        .select(recordColumns)
        .from(sitepingFeedbacks)
        .where(eq(sitepingFeedbacks.clientId, clientId))
        .limit(1);
      return row ?? null;
    },
    async findProjectName(id) {
      const [row] = await db
        .select({ projectName: sitepingFeedbacks.projectName })
        .from(sitepingFeedbacks)
        .where(eq(sitepingFeedbacks.id, id))
        .limit(1);
      return row?.projectName ?? null;
    },
    async updateStatus(id, { status, resolvedAt, updatedAt }) {
      const [row] = await db
        .update(sitepingFeedbacks)
        .set({
          status,
          resolvedAt,
          updatedAt: monotonicUpdatedAt(sitepingFeedbacks, updatedAt, GREATEST_VALUE_FUNCTION.sqlite),
        })
        .where(eq(sitepingFeedbacks.id, id))
        .returning(recordColumns);
      return row ?? null;
    },
    async deleteById(id, options) {
      // Annotations cascade only with `PRAGMA foreign_keys = ON`, which libSQL
      // does not guarantee — delete them explicitly in the same batch.
      const [, deleted] = await db.batch([
        db.delete(sitepingAnnotations).where(eq(sitepingAnnotations.feedbackId, id)),
        db
          .delete(sitepingFeedbacks)
          .where(eq(sitepingFeedbacks.id, id))
          .returning(deletedFeedbackColumns(sitepingFeedbacks, options)),
      ]);
      return deleted.length > 0 ? toDeletedFeedbacks(deleted) : null;
    },
    async deleteByProject(projectName, options) {
      const projectFeedbackIds = db
        .select({ id: sitepingFeedbacks.id })
        .from(sitepingFeedbacks)
        .where(eq(sitepingFeedbacks.projectName, projectName));
      const deleteAnnotations = db
        .delete(sitepingAnnotations)
        .where(inArray(sitepingAnnotations.feedbackId, projectFeedbackIds));
      const deleteFeedbacks = db.delete(sitepingFeedbacks).where(eq(sitepingFeedbacks.projectName, projectName));
      if (!options.collectScreenshotUrls) {
        await db.batch([deleteAnnotations, deleteFeedbacks]);
        return { screenshotUrls: [] };
      }
      const [, deleted] = await db.batch([
        deleteAnnotations,
        deleteFeedbacks.returning(deletedFeedbackColumns(sitepingFeedbacks, options)),
      ]);
      return toDeletedFeedbacks(deleted);
    },
  };
}

/**
 * `SitepingStore` on Turso / libSQL through Drizzle ORM.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/libsql";
 * import { createLibSQLSitepingStore } from "@siteping/adapter-drizzle/libsql";
 *
 * const db = drizzle({ connection: { url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! } });
 * const store = createLibSQLSitepingStore(db, { screenshotStorage });
 * ```
 */
export function createLibSQLSitepingStore(
  db: AnyLibSQLDatabase,
  options: LibSQLSitepingStoreOptions = {},
): DrizzleStore {
  const { tables = createSitepingSqliteTables(), ...storeOptions } = options;
  return new DrizzleSitepingStore(createLibSQLGateway(db, tables), storeOptions);
}
