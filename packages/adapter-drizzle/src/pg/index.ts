import { primaryOf } from "../shared/replicas.js";
import { DrizzleBeezpingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { type AnyPgDatabase, createPgGateway } from "./gateway.js";
import { type BeezpingPgTables, createBeezpingPgTables } from "./tables.js";

export type { BeezpingStore, FeedbackRecord, ScreenshotStorage } from "@beezping/core";
export {
  isStorePersistence,
  StoreDuplicateError,
  StoreLimitError,
  StoreNotFoundError,
  StorePersistenceError,
} from "@beezping/core";
export { type BeezpingTableNames, DEFAULT_BEEZPING_TABLE_NAMES } from "../constants/table-names.js";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "../shared/store.js";
export type { AnyPgDatabase } from "./gateway.js";
export { type BeezpingPgTables, createBeezpingPgTables } from "./tables.js";

export interface PgBeezpingStoreOptions extends DrizzleStoreOptions {
  /** Tables built with `createBeezpingPgTables` — pass them when you customized the names. */
  tables?: BeezpingPgTables | undefined;
}

/**
 * `BeezpingStore` on PostgreSQL through Drizzle ORM. Given a database built
 * with `withReplicas`, it runs everything on the primary.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { createPgBeezpingStore } from "@beezping/adapter-drizzle/pg";
 *
 * const store = createPgBeezpingStore(drizzle(process.env.DATABASE_URL!), { screenshotStorage });
 * ```
 */
export function createPgBeezpingStore(db: AnyPgDatabase, options: PgBeezpingStoreOptions = {}): DrizzleStore {
  const { tables = createBeezpingPgTables(), ...storeOptions } = options;
  return new DrizzleBeezpingStore(createPgGateway(primaryOf(db), tables), storeOptions);
}
