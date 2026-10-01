[![npm version](https://img.shields.io/npm/v/@beezping/adapter-drizzle)](https://www.npmjs.com/package/@beezping/adapter-drizzle)
[![Docs](https://img.shields.io/badge/docs-siteping.dev-0066ff)](https://siteping.dev/docs/adapters/drizzle)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/adapter-drizzle

[Drizzle ORM](https://orm.drizzle.team) store for [SitePing](https://github.com/NeosiaNexus/SitePing), on **PostgreSQL** (node-postgres, postgres.js, Neon HTTP, PGlite…) or **Turso / libSQL**.

**[Documentation](https://siteping.dev/docs/adapters/drizzle)**

## Install

```bash
npm install @beezping/adapter-drizzle @beezping/server drizzle-orm
```

**Peer dependency:** `drizzle-orm` `>=0.45 <1` · Node ≥ 20.

## Quick start

```ts
// db/schema.ts — then `drizzle-kit generate` as usual
import { createSitepingPgTables } from "@beezping/adapter-drizzle/pg";
export const { sitepingFeedbacks, sitepingAnnotations, sitepingComments } = createSitepingPgTables();

// server
import { drizzle } from "drizzle-orm/node-postgres";
import { createPgSitepingStore } from "@beezping/adapter-drizzle/pg";
const store = createPgSitepingStore(drizzle(process.env.DATABASE_URL!), { logger: console });
```

Turso / libSQL: same shape with `createSitepingSqliteTables` and `createLibSQLSitepingStore` from `@beezping/adapter-drizzle/libsql`. Serve the store with `createSitepingHandler({ store })` from `@beezping/server`.

## Documentation

Schema setup and migrations, serving the store, options, the screenshot storage contract, concurrency guarantees and limitations: **[siteping.dev/docs/adapters/drizzle](https://siteping.dev/docs/adapters/drizzle)**.

## License

[MIT](https://github.com/NeosiaNexus/SitePing/blob/main/LICENSE)
