[![npm version](https://img.shields.io/npm/v/@beezping/adapter-memory)](https://www.npmjs.com/package/@beezping/adapter-memory)
[![Docs](https://img.shields.io/badge/docs-siteping.dev-0066ff)](https://siteping.dev/docs/adapters/memory)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/adapter-memory

In-memory store for [SitePing](https://github.com/NeosiaNexus/SitePing) — zero dependencies, zero configuration. For tests, previews, and throwaway demos: restart the process and it's gone.

**[Documentation](https://siteping.dev/docs/adapters/memory)**

## Install

```bash
npm install @beezping/adapter-memory
npm install @beezping/server # only to serve it over HTTP
```

## Usage

```ts
import { MemoryStore } from "@beezping/adapter-memory";
import { createSitepingHandler } from "@beezping/server";

const store = new MemoryStore();

// Behind the HTTP handler (server, no Prisma involved):
createSitepingHandler({ store });

// Or directly in the widget (client-side mode):
initSiteping({ store, projectName: "preview" });
```

`clear()` resets it between test cases. Duplicate `clientId` submissions return the existing record (retry-safe), unknown IDs throw `StoreNotFoundError`, and records are returned **by reference** — clone before mutating.

Writing your own adapter? This store passes the shared 67-test conformance suite (`testSitepingStore` from `@beezping/adapter-kit/testing`) — yours should too.

## License

[MIT](https://github.com/NeosiaNexus/SitePing/blob/main/LICENSE)
