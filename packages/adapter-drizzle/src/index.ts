/**
 * Drizzle ORM adapters for SitePing. Import the entry for your database:
 *
 * - `@siteping/adapter-drizzle/pg` — PostgreSQL (node-postgres, postgres.js, Neon, PGlite…)
 * - `@siteping/adapter-drizzle/libsql` — Turso / libSQL
 */
export type { FeedbackRecord, ScreenshotStorage, SitepingStore } from "@siteping/core";
export type { DrizzleStore, DrizzleStoreLogger, DrizzleStoreOptions } from "./shared/store.js";
export { DEFAULT_SITEPING_TABLE_NAMES, type SitepingTableNames } from "./shared/table-names.js";
