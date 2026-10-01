/**
 * Drizzle ORM adapters for Beezping. Import the entry for your database:
 *
 * - `@beezping/adapter-drizzle/pg` — PostgreSQL (node-postgres, postgres.js, Neon, PGlite…)
 * - `@beezping/adapter-drizzle/libsql` — Turso / libSQL
 */
export type { BeezpingStore, FeedbackRecord, ScreenshotStorage } from "@beezping/core";
export { type BeezpingTableNames, DEFAULT_BEEZPING_TABLE_NAMES } from "./constants/table-names.js";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "./shared/store.js";
