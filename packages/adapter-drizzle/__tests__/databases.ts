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
  /** The same database behind a driver that rejects responses larger than `maxResponseBytes`, as HTTP drivers do. */
  withResponseSizeLimit(maxResponseBytes: number): Database;
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
    withResponseSizeLimit: (maxResponseBytes) =>
      drizzlePglite({ client: withResponseSizeLimit(client, maxResponseBytes, PGLITE_RESULT_METHODS) }),
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
    withResponseSizeLimit: (maxResponseBytes) =>
      drizzleLibSQL({ client: withResponseSizeLimit(client, maxResponseBytes, LIBSQL_RESULT_METHODS) }),
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

/**
 * The same database, minus interactive transactions: `db.transaction(callback)`
 * throws exactly as it does on drivers without them (`drizzle-orm/neon-http`,
 * Cloudflare D1…). No such driver runs locally, so this test-owned wrapper
 * stands in for one while every statement still executes on the real engine.
 */
export function withoutInteractiveTransactions<Database extends object>(db: Database): Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return () => {
          throw new Error("No transactions support in this driver (interactive transactions are unavailable)");
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Driver methods that return query results, per client. */
const PGLITE_RESULT_METHODS = ["query"] as const;
const LIBSQL_RESULT_METHODS = ["execute", "batch"] as const;

/** Serialized size of the rows a driver call returned (one result or a batch of them). */
function resultRowsBytes(result: unknown): number {
  const results = Array.isArray(result) ? result : [result];
  const rows = results.map((single) => (single as { rows?: unknown } | null)?.rows ?? []);
  return JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? value.toString() : value)).length;
}

/**
 * The same client, with the response-size cap of HTTP database drivers
 * (Neon HTTP, Turso over HTTP…): a call whose rows exceed `maxResponseBytes`
 * rejects after running. No such driver runs locally, so this test-owned
 * wrapper stands in for one while every statement executes on the real engine.
 */
function withResponseSizeLimit<Client extends object>(
  client: Client,
  maxResponseBytes: number,
  resultMethods: readonly string[],
): Client {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const bound = value.bind(target);
      if (typeof property !== "string" || !resultMethods.includes(property)) return bound;
      return async (...args: unknown[]) => {
        const result = await bound(...args);
        const bytes = resultRowsBytes(result);
        if (bytes > maxResponseBytes) {
          throw new Error(`Response too large: ${bytes} bytes exceed the ${maxResponseBytes}-byte driver limit`);
        }
        return result;
      };
    },
  });
}
