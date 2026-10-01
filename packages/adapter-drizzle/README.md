[![npm version](https://img.shields.io/npm/v/@beezping/adapter-drizzle)](https://www.npmjs.com/package/@beezping/adapter-drizzle)
[![Docs](https://img.shields.io/badge/docs-github.com/guidomodarelli/beezping-0066ff)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/adapters/drizzle.mdx)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/adapter-drizzle

[Drizzle ORM](https://orm.drizzle.team) store for [Beezping](https://github.com/guidomodarelli/beezping), on **PostgreSQL** (node-postgres, postgres.js, Neon HTTP, PGlite…) or **Turso / libSQL**.

**[Documentation](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/adapters/drizzle.mdx)**

## Install

```bash
npm install @beezping/adapter-drizzle @beezping/server drizzle-orm
```

**Peer dependency:** `drizzle-orm` `>=0.45 <1` · Node ≥ 20.

## Quick start

```ts
// db/schema.ts — then `drizzle-kit generate` as usual
import { createBeezpingPgTables } from "@beezping/adapter-drizzle/pg";
export const { beezpingFeedbacks, beezpingAnnotations, beezpingComments } = createBeezpingPgTables();

// server
import { drizzle } from "drizzle-orm/node-postgres";
import { createPgBeezpingStore } from "@beezping/adapter-drizzle/pg";
const store = createPgBeezpingStore(drizzle(process.env.DATABASE_URL!), { logger: console });
```

Turso / libSQL: same shape with `createBeezpingSqliteTables` and `createLibSQLBeezpingStore` from `@beezping/adapter-drizzle/libsql`. Serve the store with `createBeezpingHandler({ store })` from `@beezping/server`.

## Documentation

Schema setup and migrations, serving the store, options, the screenshot storage contract, concurrency guarantees and limitations: **[github.com/guidomodarelli/beezping/docs/adapters/drizzle](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/adapters/drizzle.mdx)**.

## License

[MIT](https://github.com/guidomodarelli/beezping/blob/main/LICENSE)
