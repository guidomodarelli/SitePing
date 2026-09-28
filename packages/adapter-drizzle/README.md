# @siteping/adapter-drizzle

[Drizzle ORM](https://orm.drizzle.team) store for [Siteping](https://siteping.dev), on **PostgreSQL** or **Turso / libSQL**.

## 1. Add the tables to your Drizzle schema

```ts
// db/schema.ts — PostgreSQL
import { createSitepingPgTables } from "@siteping/adapter-drizzle/pg";
export const { sitepingFeedbacks, sitepingAnnotations } = createSitepingPgTables();

// db/schema.ts — Turso / libSQL
import { createSitepingSqliteTables } from "@siteping/adapter-drizzle/libsql";
export const { sitepingFeedbacks, sitepingAnnotations } = createSitepingSqliteTables();
```

Then `drizzle-kit generate` (or `push`) as usual. The annotations table carries a `position` column (integer, default `0`) that keeps each feedback's annotations in submission order — `annotations[0]` is the primary anchor; if you created the tables with an earlier version, generate a migration to add it. The feedbacks table likewise carries an internal `creation_sequence` column that breaks `created_at` ties, so rows created in the same millisecond by different processes still list newest first and paginate stably: a `bigint` identity on PostgreSQL (existing rows are numbered when the column is added), and an indexed integer (default `0`) on libSQL that the store fills on insert — older rows keep `0` and only their `created_at` order. Generate a migration to add it too. Pass `{ feedbacks, annotations }` to rename the tables, and hand the same tables to the store through `tables`.

## 2. Create the store

```ts
// PostgreSQL — node-postgres, postgres.js, Neon, PGlite…
import { drizzle } from "drizzle-orm/node-postgres";
import { createPgSitepingStore } from "@siteping/adapter-drizzle/pg";
const store = createPgSitepingStore(drizzle(process.env.DATABASE_URL!), { screenshotStorage });

// Turso / libSQL
import { drizzle } from "drizzle-orm/libsql";
import { createLibSQLSitepingStore } from "@siteping/adapter-drizzle/libsql";
const store = createLibSQLSitepingStore(
  drizzle({ connection: { url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN } }),
  { screenshotStorage },
);
```

Serve it with `createSitepingHandler({ store, … })` from `@siteping/server`. Without `screenshotStorage`, screenshots are stored inline as base64. With it, `upload` receives as `feedbackId` the id the record will be stored under — generated server-side and unique per create attempt, not the client's `clientId` — so key objects by it: when two submissions of the same feedback race, each uploads its own object and the one that loses the insert deletes it (through `delete`), leaving the winner's screenshot intact.

The store implements the whole contract, including `verifyProjectOwnership` (needed by project-scoped `access.authorize`) and an atomic `createFeedbackIfAbsent`: the unique `client_id` index arbitrates concurrent submissions of the same feedback, even across processes, so creation webhooks fire once. The store never opens an interactive `db.transaction`: on PostgreSQL every write is a single statement (so Neon HTTP works), and on libSQL multi-statement writes go through `db.batch`, which never holds the write lock across an `await` — your application can keep writing to the same database concurrently. When several processes share one local libSQL **file**, set the client's busy `timeout` so their writes queue instead of failing with `SQLITE_BUSY`.

Database failures on writes (read-only or full database, lost connection…) surface as `StorePersistenceError` (detect it with `isStorePersistence`, exported by both entries), with the driver error as `cause`; a missing record stays `StoreNotFoundError`.

Requires `drizzle-orm` ≥ 0.45. The libSQL entry targets `drizzle-orm/libsql` (Turso, embedded replicas, local files); other SQLite drivers (better-sqlite3, Cloudflare D1) are not supported.

MIT
