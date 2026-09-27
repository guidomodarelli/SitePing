import { and, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { FeedbackFilter, SitepingSqlGateway } from "../shared/gateway.js";
import { toContainsPattern } from "../shared/gateway.js";
import { DrizzleSitepingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { createSitepingSqliteTables, type SitepingSqliteTables } from "./tables.js";

export type { FeedbackRecord, ScreenshotStorage, SitepingStore } from "@siteping/core";
export { StoreDuplicateError, StoreNotFoundError, StorePersistenceError } from "@siteping/core";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "../shared/store.js";
export { DEFAULT_SITEPING_TABLE_NAMES, type SitepingTableNames } from "../shared/table-names.js";
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
  const whereClause = (filter: FeedbackFilter): SQL | undefined => {
    const conditions: SQL[] = [eq(sitepingFeedbacks.projectName, filter.projectName)];
    if (filter.type) conditions.push(eq(sitepingFeedbacks.type, filter.type));
    if (filter.statuses) conditions.push(inArray(sitepingFeedbacks.status, [...filter.statuses]));
    if (filter.url) conditions.push(eq(sitepingFeedbacks.url, filter.url));
    if (filter.urlPattern) conditions.push(eq(sitepingFeedbacks.urlPattern, filter.urlPattern));
    // SQLite's LIKE is case-insensitive for ASCII letters.
    if (filter.search) {
      conditions.push(sql`${sitepingFeedbacks.message} LIKE ${toContainsPattern(filter.search)} ESCAPE '\\'`);
    }
    return and(...conditions);
  };

  return {
    async insertFeedback(feedback, annotations) {
      return db.transaction(async (transaction) => {
        const inserted = await transaction
          .insert(sitepingFeedbacks)
          .values(feedback)
          .onConflictDoNothing({ target: sitepingFeedbacks.clientId })
          .returning({ id: sitepingFeedbacks.id });
        if (inserted.length === 0) return false;
        if (annotations.length > 0) await transaction.insert(sitepingAnnotations).values([...annotations]);
        return true;
      });
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
      const [row] = await db.update(sitepingFeedbacks).set(update).where(eq(sitepingFeedbacks.id, id)).returning();
      return row ?? null;
    },
    async deleteById(id) {
      // Annotations cascade only with `PRAGMA foreign_keys = ON`, which libSQL
      // does not guarantee — delete them explicitly in the same transaction.
      return db.transaction(async (transaction) => {
        await transaction.delete(sitepingAnnotations).where(eq(sitepingAnnotations.feedbackId, id));
        const [row] = await transaction.delete(sitepingFeedbacks).where(eq(sitepingFeedbacks.id, id)).returning();
        return row ?? null;
      });
    },
    async deleteByProject(projectName) {
      return db.transaction(async (transaction) => {
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
      });
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
