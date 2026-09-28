import { count, desc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { CASE_INSENSITIVE_LIKE_OPERATOR } from "../constants/search.js";
import { buildFeedbackWhere } from "../shared/filters.js";
import type { FeedbackFilter, SitepingSqlGateway } from "../shared/gateway.js";
import { DrizzleSitepingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { createSitepingSqliteTables, type SitepingSqliteTables } from "./tables.js";
import { enqueueWrite } from "./write-queue.js";

export type { FeedbackRecord, ScreenshotStorage, SitepingStore } from "@siteping/core";
export { StoreDuplicateError, StoreNotFoundError, StorePersistenceError } from "@siteping/core";
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

  return {
    async insertFeedback(feedback, annotations) {
      return enqueueWrite(db, () =>
        db.transaction(async (transaction) => {
          const inserted = await transaction
            .insert(sitepingFeedbacks)
            .values(feedback)
            .onConflictDoNothing({ target: sitepingFeedbacks.clientId })
            .returning({ id: sitepingFeedbacks.id });
          if (inserted.length === 0) return false;
          if (annotations.length > 0) await transaction.insert(sitepingAnnotations).values([...annotations]);
          return true;
        }),
      );
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
        .select()
        .from(sitepingAnnotations)
        .where(inArray(sitepingAnnotations.feedbackId, [...feedbackIds]))
        .orderBy(sitepingAnnotations.createdAt);
    },
    async findByClientId(clientId) {
      const [row] = await db.select().from(sitepingFeedbacks).where(eq(sitepingFeedbacks.clientId, clientId)).limit(1);
      return row ?? null;
    },
    async findById(id) {
      const [row] = await db.select().from(sitepingFeedbacks).where(eq(sitepingFeedbacks.id, id)).limit(1);
      return row ?? null;
    },
    async updateStatus(id, update) {
      const [row] = await enqueueWrite(db, () =>
        db.update(sitepingFeedbacks).set(update).where(eq(sitepingFeedbacks.id, id)).returning(),
      );
      return row ?? null;
    },
    async deleteById(id) {
      // Annotations cascade only with `PRAGMA foreign_keys = ON`, which libSQL
      // does not guarantee — delete them explicitly in the same transaction.
      return enqueueWrite(db, () =>
        db.transaction(async (transaction) => {
          await transaction.delete(sitepingAnnotations).where(eq(sitepingAnnotations.feedbackId, id));
          const [row] = await transaction.delete(sitepingFeedbacks).where(eq(sitepingFeedbacks.id, id)).returning();
          return row ?? null;
        }),
      );
    },
    async deleteByProject(projectName) {
      return enqueueWrite(db, () =>
        db.transaction(async (transaction) => {
          const projectFeedbackIds = transaction
            .select({ id: sitepingFeedbacks.id })
            .from(sitepingFeedbacks)
            .where(eq(sitepingFeedbacks.projectName, projectName));
          await transaction
            .delete(sitepingAnnotations)
            .where(inArray(sitepingAnnotations.feedbackId, projectFeedbackIds));
          const rows = await transaction
            .delete(sitepingFeedbacks)
            .where(eq(sitepingFeedbacks.projectName, projectName))
            .returning({ screenshotUrl: sitepingFeedbacks.screenshotUrl });
          return rows.map((row) => row.screenshotUrl);
        }),
      );
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
