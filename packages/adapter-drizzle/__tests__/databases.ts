import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { pushSchema, pushSQLiteSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { drizzle as drizzleLibSQL } from "drizzle-orm/libsql";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { SitepingTableNames } from "../src/constants/table-names.js";
import { type AnyLibSQLDatabase, createSitepingSqliteTables } from "../src/libsql/index.js";
import { type AnyPgDatabase, createSitepingPgTables } from "../src/pg/index.js";

/**
 * Real database engines for the tests — no mocks: PGlite is PostgreSQL
 * compiled to WASM, and libSQL runs on a temporary file (an in-memory libSQL
 * database is per-connection, and transactions open a new connection).
 * Tables are created by drizzle-kit from the adapter's own table
 * definitions, so the schema under test is exactly what users migrate.
 */

export interface TestDatabase<Database> {
  db: Database;
  /** Empty every SitePing table between tests. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createPgTestDatabase(names?: SitepingTableNames): Promise<TestDatabase<AnyPgDatabase>> {
  const client = new PGlite();
  const db = drizzlePglite(client);
  const tables = createSitepingPgTables(names);
  const { apply } = await pushSchema(tables, db as never);
  await apply();
  return {
    db,
    async reset() {
      await db.execute(sql`TRUNCATE ${tables.sitepingAnnotations}, ${tables.sitepingFeedbacks}`);
    },
    close: () => client.close(),
  };
}

export async function createLibSQLTestDatabase(names?: SitepingTableNames): Promise<TestDatabase<AnyLibSQLDatabase>> {
  const directory = mkdtempSync(join(tmpdir(), "siteping-libsql-"));
  const client = createClient({ url: `file:${join(directory, "siteping.db")}` });
  const db = drizzleLibSQL(client);
  const tables = createSitepingSqliteTables(names);
  const { apply } = await pushSQLiteSchema(tables, db);
  await apply();
  return {
    db,
    async reset() {
      await db.delete(tables.sitepingAnnotations);
      await db.delete(tables.sitepingFeedbacks);
    },
    async close() {
      client.close();
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (cleanupError) {
        // On Windows the native libSQL client can keep the file handle open
        // past close(); the OS temp directory reclaims the leftover file.
        console.warn(`libSQL test database left at ${directory}:`, cleanupError);
      }
    },
  };
}
