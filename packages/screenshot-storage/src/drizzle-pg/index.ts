import { eq } from "drizzle-orm";
import { customType, type PgDatabase, type PgQueryResultHKT, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DEFAULT_SCREENSHOTS_TABLE_NAME } from "../constants/database.js";
import { toBytes } from "../core/binary.js";
import type { ScreenshotObjectStore } from "../core/object-store.js";
import { createPublicUrlMapping } from "../core/public-url.js";

/**
 * `bytea` column. node-postgres only serializes Node `Buffer`s as binary, so
 * values are sent as `Buffer` where it exists (Node, Bun) and as `Uint8Array`
 * elsewhere (PGlite, edge drivers).
 */
const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: unknown }>({
  dataType: () => "bytea",
  toDriver: (bytes) =>
    typeof Buffer === "undefined" ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  fromDriver: toBytes,
});

/**
 * Build the screenshots table for PostgreSQL. Export it from your Drizzle
 * schema so `drizzle-kit` migrates it:
 *
 * ```ts
 * export const sitepingScreenshots = createSitepingScreenshotsPgTable();
 * ```
 */
export function createSitepingScreenshotsPgTable(name: string = DEFAULT_SCREENSHOTS_TABLE_NAME) {
  return pgTable(name, {
    key: text("key").primaryKey(),
    contentType: text("content_type").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  });
}

export type SitepingScreenshotsPgTable = ReturnType<typeof createSitepingScreenshotsPgTable>;

// biome-ignore lint/suspicious/noExplicitAny: accepts every driver's query-result HKT and schema.
type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

export interface PgScreenshotObjectStoreOptions {
  /** Where `createScreenshotServeHandler` is mounted, e.g. `https://app.example.com/api/siteping/screenshots`. */
  publicBaseUrl: string;
  /** The table from `createSitepingScreenshotsPgTable` — pass it when you renamed it. */
  table?: SitepingScreenshotsPgTable;
}

/**
 * Screenshots stored as `bytea` rows in PostgreSQL through Drizzle — keeps
 * everything in the database you already run. Serve them with
 * `createScreenshotServeHandler`.
 */
export function createPgScreenshotObjectStore(
  db: AnyPgDatabase,
  { publicBaseUrl, table = createSitepingScreenshotsPgTable() }: PgScreenshotObjectStoreOptions,
): ScreenshotObjectStore {
  return {
    name: "PostgreSQL",
    ...createPublicUrlMapping(publicBaseUrl),
    async put({ key, bytes, contentType }) {
      await db.insert(table).values({ key, bytes, contentType });
    },
    async remove(key) {
      await db.delete(table).where(eq(table.key, key));
    },
    async get(key) {
      const [row] = await db
        .select({ bytes: table.bytes, contentType: table.contentType })
        .from(table)
        .where(eq(table.key, key))
        .limit(1);
      return row ?? null;
    },
  };
}

export type { ScreenshotObjectStore } from "../core/object-store.js";
