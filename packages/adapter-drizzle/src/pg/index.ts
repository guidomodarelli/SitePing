import { type Column, count, desc, eq, getTableColumns, inArray, type SQL, sql, type WithSubquery } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { CASE_INSENSITIVE_LIKE_OPERATOR } from "../constants/search.js";
import {
  GREATEST_VALUE_FUNCTION,
  INSERTED_ANNOTATIONS_CTE_ALIAS,
  INSERTED_FEEDBACK_CTE_ALIAS,
} from "../constants/sql.js";
import { annotationRecordColumns, selectAnnotationValues } from "../shared/annotations.js";
import { buildFeedbackWhere } from "../shared/filters.js";
import type { FeedbackFilter, FeedbackRow, SitepingSqlGateway } from "../shared/gateway.js";
import { DrizzleSitepingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { monotonicUpdatedAt } from "../shared/timestamps.js";
import { createSitepingPgTables, type SitepingPgTables } from "./tables.js";

export type { FeedbackRecord, ScreenshotStorage, SitepingStore } from "@siteping/core";
export { isStorePersistence, StoreDuplicateError, StoreNotFoundError, StorePersistenceError } from "@siteping/core";
export { DEFAULT_SITEPING_TABLE_NAMES, type SitepingTableNames } from "../constants/table-names.js";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "../shared/store.js";
export { createSitepingPgTables, type SitepingPgTables } from "./tables.js";

/**
 * Any Drizzle PostgreSQL database — node-postgres, postgres.js, Neon
 * (serverless / HTTP), Vercel Postgres, Supabase, PGlite… The store never
 * opens an interactive `db.transaction`: every write is a single statement,
 * so drivers without interactive transactions (Neon HTTP) work too.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts every driver's query-result HKT and schema.
export type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

export interface PgSitepingStoreOptions extends DrizzleStoreOptions {
  /** Tables built with `createSitepingPgTables` — pass them when you customized the names. */
  tables?: SitepingPgTables;
}

/**
 * Type a bound parameter as its target column: parameters inside a `VALUES`
 * list carry no type of their own in PostgreSQL.
 */
function castToColumnType(param: SQL, column: Column): SQL {
  return sql`CAST(${param} AS ${sql.raw(column.getSQLType())})`;
}

function createPgGateway(
  db: AnyPgDatabase,
  { sitepingFeedbacks, sitepingAnnotations }: SitepingPgTables,
): SitepingSqlGateway {
  const whereClause = (filter: FeedbackFilter) =>
    buildFeedbackWhere(sitepingFeedbacks, filter, CASE_INSENSITIVE_LIKE_OPERATOR.postgres);

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
            .insert(sitepingFeedbacks)
            .values(feedback)
            .onConflictDoNothing({ target: sitepingFeedbacks.clientId })
            .returning({ id: sitepingFeedbacks.id }),
        );
      const statements: WithSubquery[] = [insertedFeedback];
      if (annotations.length > 0) {
        // Data-modifying CTEs always run to completion, even unreferenced.
        statements.push(
          db
            .$with(INSERTED_ANNOTATIONS_CTE_ALIAS)
            .as(
              db
                .insert(sitepingAnnotations)
                .select(
                  selectAnnotationValues(
                    sitepingAnnotations,
                    annotations,
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
      const [rows, totals] = await Promise.all([
        db
          .select()
          .from(sitepingFeedbacks)
          .where(where)
          .orderBy(desc(sitepingFeedbacks.createdAt))
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
      const [row] = await db.select().from(sitepingFeedbacks).where(eq(sitepingFeedbacks.clientId, clientId)).limit(1);
      return row ?? null;
    },
    async findById(id) {
      const [row] = await db.select().from(sitepingFeedbacks).where(eq(sitepingFeedbacks.id, id)).limit(1);
      return row ?? null;
    },
    async updateStatus(id, { status, resolvedAt, updatedAt }) {
      const [row] = await db
        .update(sitepingFeedbacks)
        .set({
          status,
          resolvedAt,
          updatedAt: monotonicUpdatedAt(sitepingFeedbacks, updatedAt, GREATEST_VALUE_FUNCTION.postgres),
        })
        .where(eq(sitepingFeedbacks.id, id))
        .returning();
      return row ?? null;
    },
    async deleteById(id) {
      const [row] = await db.delete(sitepingFeedbacks).where(eq(sitepingFeedbacks.id, id)).returning();
      return (row as FeedbackRow | undefined) ?? null;
    },
    async deleteByProject(projectName) {
      const rows = await db
        .delete(sitepingFeedbacks)
        .where(eq(sitepingFeedbacks.projectName, projectName))
        .returning({ screenshotUrl: sitepingFeedbacks.screenshotUrl });
      return rows.map((row) => row.screenshotUrl);
    },
  };
}

/**
 * `SitepingStore` on PostgreSQL through Drizzle ORM.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { createPgSitepingStore } from "@siteping/adapter-drizzle/pg";
 *
 * const store = createPgSitepingStore(drizzle(process.env.DATABASE_URL!), { screenshotStorage });
 * ```
 */
export function createPgSitepingStore(db: AnyPgDatabase, options: PgSitepingStoreOptions = {}): DrizzleStore {
  const { tables = createSitepingPgTables(), ...storeOptions } = options;
  return new DrizzleSitepingStore(createPgGateway(db, tables), storeOptions);
}
