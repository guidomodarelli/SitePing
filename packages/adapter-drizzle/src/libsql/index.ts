import { is } from "drizzle-orm";
import { LibSQLDatabase } from "drizzle-orm/libsql/driver-core";
import { DRIZZLE_STORE_MESSAGE_PREFIX } from "../constants/errors.js";
import { primaryOf } from "../shared/replicas.js";
import { DrizzleBeezpingStore, type DrizzleStore, type DrizzleStoreOptions } from "../shared/store.js";
import { type AnyLibSQLDatabase, createLibSQLGateway } from "./gateway.js";
import { type BeezpingSqliteTables, createBeezpingSqliteTables } from "./tables.js";

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
export type { AnyLibSQLDatabase } from "./gateway.js";
export { type BeezpingSqliteTables, createBeezpingSqliteTables } from "./tables.js";

export interface LibSQLBeezpingStoreOptions extends DrizzleStoreOptions {
  /** Tables built with `createBeezpingSqliteTables` — pass them when you customized the names. */
  tables?: BeezpingSqliteTables | undefined;
}

/**
 * `BeezpingStore` on Turso / libSQL through Drizzle ORM. Given a database
 * built with `withReplicas`, it runs everything on the primary.
 *
 * @throws `TypeError` when `db` does not come from `drizzle-orm/libsql`.
 *   Another SQLite driver's database (Cloudflare D1…) passes the type check
 *   where `@libsql/client`'s types do not resolve, and would fail only at run
 *   time, on the data: D1 binds at most 100 parameters per query, and a
 *   feedback with 5 annotations binds more.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/libsql";
 * import { createLibSQLBeezpingStore } from "@beezping/adapter-drizzle/libsql";
 *
 * const db = drizzle({ connection: { url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! } });
 * const store = createLibSQLBeezpingStore(db, { screenshotStorage });
 * ```
 */
export function createLibSQLBeezpingStore(
  db: AnyLibSQLDatabase,
  options: LibSQLBeezpingStoreOptions = {},
): DrizzleStore {
  const primary = primaryOf(db);
  if (!is(primary, LibSQLDatabase)) {
    throw new TypeError(
      `${DRIZZLE_STORE_MESSAGE_PREFIX}: createLibSQLBeezpingStore needs a database from drizzle-orm/libsql — other SQLite drivers (Cloudflare D1, better-sqlite3…) are not supported`,
    );
  }
  const { tables = createBeezpingSqliteTables(), ...storeOptions } = options;
  return new DrizzleBeezpingStore(createLibSQLGateway(primary, tables), storeOptions);
}
