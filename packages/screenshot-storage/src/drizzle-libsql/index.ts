import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DEFAULT_SCREENSHOTS_TABLE_NAME } from "../constants/database.js";
import { toBytes } from "../core/binary.js";
import type { ScreenshotObjectStore } from "../core/object-store.js";
import { createPublicUrlMapping } from "../core/public-url.js";

/** `blob` column read back as `Uint8Array` (libSQL returns `ArrayBuffer`); no Node `Buffer` needed. */
const blob = customType<{ data: Uint8Array<ArrayBuffer>; driverData: unknown }>({
  dataType: () => "blob",
  toDriver: (bytes) => bytes,
  fromDriver: toBytes,
});

/**
 * Build the screenshots table for SQLite / libSQL (Turso). Export it from
 * your Drizzle schema so `drizzle-kit` migrates it:
 *
 * ```ts
 * export const sitepingScreenshots = createSitepingScreenshotsSqliteTable();
 * ```
 */
export function createSitepingScreenshotsSqliteTable(name: string = DEFAULT_SCREENSHOTS_TABLE_NAME) {
  return sqliteTable(name, {
    key: text("key").primaryKey(),
    contentType: text("content_type").notNull(),
    bytes: blob("bytes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  });
}

export type SitepingScreenshotsSqliteTable = ReturnType<typeof createSitepingScreenshotsSqliteTable>;

// biome-ignore lint/suspicious/noExplicitAny: accepts every schema generic.
type AnyLibSQLDatabase = LibSQLDatabase<any>;

export interface LibSQLScreenshotObjectStoreOptions {
  /** Where `createScreenshotServeHandler` is mounted, e.g. `https://app.example.com/api/siteping/screenshots`. */
  publicBaseUrl: string;
  /** The table from `createSitepingScreenshotsSqliteTable` — pass it when you renamed it. */
  table?: SitepingScreenshotsSqliteTable;
}

/**
 * Screenshots stored as `blob` rows in Turso / libSQL through Drizzle.
 * Serve them with `createScreenshotServeHandler`.
 */
export function createLibSQLScreenshotObjectStore(
  db: AnyLibSQLDatabase,
  { publicBaseUrl, table = createSitepingScreenshotsSqliteTable() }: LibSQLScreenshotObjectStoreOptions,
): ScreenshotObjectStore {
  return {
    name: "libSQL",
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
