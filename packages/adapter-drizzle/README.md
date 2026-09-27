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

Then `drizzle-kit generate` (or `push`) as usual. Pass `{ feedbacks, annotations }` to rename the tables, and hand the same tables to the store through `tables`.

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

Serve it with `createSitepingHandler({ store, … })` from `@siteping/server`. Without `screenshotStorage`, screenshots are stored inline as base64.

Requires `drizzle-orm` ≥ 0.45. The libSQL entry uses interactive transactions, so synchronous SQLite drivers (better-sqlite3) and Cloudflare D1 are not supported.

MIT
