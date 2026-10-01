[![npm version](https://img.shields.io/npm/v/@beezping/server)](https://www.npmjs.com/package/@beezping/server)
[![Docs](https://img.shields.io/badge/docs-github.com/guidomodarelli/beezping-0066ff)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/server.mdx)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/server

The HTTP endpoint of [Beezping](https://github.com/guidomodarelli/beezping) over any store, for any framework — validation, auth, CORS, redaction, hooks and webhooks on the Fetch API. No Node built-in: it runs on Node, Bun, Deno and edge workers.

**[Documentation](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/server.mdx)**

## Install

```bash
npm install @beezping/server
```

Node ≥ 20, or any runtime with the Fetch API.

## Quick start

```ts
// app/api/beezping/route.ts — Next.js App Router
import { createBeezpingHandler } from "@beezping/server";
import { store } from "@/lib/beezping-store"; // Drizzle, memory, Prisma or your own

export const { GET, POST, PATCH, DELETE, OPTIONS } = createBeezpingHandler({
  store,
  apiKey: process.env.BEEZPING_API_KEY,    // Bearer auth — or `access` for your own sessions
  allowedOrigins: ["https://my-site.com"], // exact-match CORS
});
```

One handler per method, Web-standard `Request` → `Response`: mount them from Hono, Express, Remix, SvelteKit, `Bun.serve` or a Worker.

## Documentation

Mounting recipes, every option, custom access with CSRF protection, lifecycle hooks, the full HTTP reference and webhooks: **[github.com/guidomodarelli/beezping/docs/server](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/server.mdx)**.

## License

[MIT](https://github.com/guidomodarelli/beezping/blob/main/LICENSE)
