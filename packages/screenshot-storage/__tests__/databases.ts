import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@libsql/client";
import { pushSchema, pushSQLiteSchema } from "drizzle-kit/api";
import { drizzle as drizzleLibSQL } from "drizzle-orm/libsql";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { createSitepingScreenshotsSqliteTable } from "../src/drizzle-libsql/index.js";
import { createSitepingScreenshotsPgTable } from "../src/drizzle-pg/index.js";

/**
 * Real database engines — PGlite (PostgreSQL in WASM) and libSQL on a temp
 * file — with the tables created by drizzle-kit from the package's own
 * definitions, so the schema under test is exactly what users migrate.
 */

export async function createPgScreenshotsDatabase() {
  const client = new PGlite();
  const db = drizzlePglite(client);
  const table = createSitepingScreenshotsPgTable();
  await (await pushSchema({ table }, db as never)).apply();
  return { db, table, close: () => client.close() };
}

export async function createLibSQLScreenshotsDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "siteping-screenshots-libsql-"));
  const client = createClient({ url: `file:${join(directory, "screenshots.db")}` });
  const db = drizzleLibSQL(client);
  const table = createSitepingScreenshotsSqliteTable();
  await (await pushSQLiteSchema({ table }, db)).apply();
  return {
    db,
    table,
    close() {
      client.close();
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (cleanupError) {
        // On Windows the native libSQL client can hold the file past close(); the OS temp dir reclaims it.
        console.warn(`libSQL test database left at ${directory}:`, cleanupError);
      }
    },
  };
}
