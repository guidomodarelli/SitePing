# @siteping/server

Framework- and database-agnostic HTTP API for [SitePing](https://siteping.dev). Built on the Fetch API (`Request` / `Response`), it runs on Next.js route handlers, Hono, Remix, SvelteKit, Bun, Deno and edge workers, over any `SitepingStore` (Prisma, Drizzle, memory, your own).

```ts
import { createSitepingHandler, createSitepingIdentityHandler } from "@siteping/server";

const access = {
  authenticate: (request: Request) => getSessionUser(request), // null → 401
  authorize: ({ principal, action }) => action === "create" || principal.isAdmin, // false → 403
};

export const { GET, POST, PATCH, DELETE, OPTIONS } = createSitepingHandler({
  store,
  access,
  beforeCreate: (input, { principal }) => ({ ...input, authorEmail: principal.email }),
  hooks: {
    onCreated: (feedback) => notifyTeam(feedback),
    onDeleting: (target) => cleanUpLinkedResources(target), // throw to abort the delete
  },
});

// Tells the host page whether to mount the widget, and as whom.
// Mount both `identity.GET` and `identity.OPTIONS` (the CORS preflight) on the identity route.
export const identity = createSitepingIdentityHandler({
  access,
  projectName: "my-site",
  resolveIdentity: (user) => ({ name: user.name, email: user.email }),
});
```

## Cross-origin widgets

Set `allowedOrigins` (exact-match allowlist) on both factories to serve a widget hosted on another origin. Each factory returns an `OPTIONS` handler answering the CORS preflight (`GET, POST, PATCH, DELETE, OPTIONS` for feedback, `GET, OPTIONS` for identity) — mount it next to the other methods. Browsers may send `Content-Type` and `Authorization`; when `access.authenticate` reads another header (a custom session or proxy identity header), declare it with `allowedHeaders` so the CORS preflight lets it through:

```ts
const cors = { allowedOrigins: ["https://client-site.com"], allowedHeaders: ["X-Session"] };

export const { GET, POST, PATCH, DELETE, OPTIONS } = createSitepingHandler({ store, access, ...cors });
```

`allowedHeaders` extends the defaults (case-insensitive, deduplicated) and throws at startup on an invalid header name; the preflight's requested headers are never reflected.

Without `access`, the handler keeps the shared-secret policy of `@siteping/adapter-prisma` (`apiKey`, `publicEndpoints`, `requireAuthForDestructive`, `redactUnauthenticatedEmails`).

MIT
