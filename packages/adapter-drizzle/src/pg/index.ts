import { and, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { FeedbackFilter, FeedbackRow, SitepingSqlGateway } from "../shared/gateway.js";
import { toContainsPattern } from "../shared/gateway.js";
import { DrizzleSitepingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { createSitepingPgTables, type SitepingPgTables } from "./tables.js";

export type { FeedbackRecord, ScreenshotStorage, SitepingStore } from "@siteping/core";
export { StoreDuplicateError, StoreNotFoundError, StorePersistenceError } from "@siteping/core";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "../shared/store.js";
export { DEFAULT_SITEPING_TABLE_NAMES, type SitepingTableNames } from "../shared/table-names.js";
export { createSitepingPgTables, type SitepingPgTables } from "./tables.js";

/**
 * Any Drizzle PostgreSQL database — node-postgres, postgres.js, Neon
 * (serverless / HTTP), Vercel Postgres, Supabase, PGlite…
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts every driver's query-result HKT and schema.
export type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

export interface PgSitepingStoreOptions extends DrizzleStoreOptions {
  /** Tables built with `createSitepingPgTables` — pass them when you customized the names. */
  tables?: SitepingPgTables;
}

function createPgGateway(
  db: AnyPgDatabase,
  { sitepingFeedbacks, sitepingAnnotations }: SitepingPgTables,
): SitepingSqlGateway {
  const whereClause = (filter: FeedbackFilter): SQL | undefined => {
    const conditions: SQL[] = [eq(sitepingFeedbacks.projectName, filter.projectName)];
    if (filter.type) conditions.push(eq(sitepingFeedbacks.type, filter.type));
    if (filter.statuses) conditions.push(inArray(sitepingFeedbacks.status, [...filter.statuses]));
    if (filter.url) conditions.push(eq(sitepingFeedbacks.url, filter.url));
    if (filter.urlPattern) conditions.push(eq(sitepingFeedbacks.urlPattern, filter.urlPattern));
    if (filter.search) {
      conditions.push(sql`${sitepingFeedbacks.message} ILIKE ${toContainsPattern(filter.search)} ESCAPE '\\'`);
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
