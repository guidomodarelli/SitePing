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
export const identity = createSitepingIdentityHandler({
  access,
  projectName: "my-site",
  resolveIdentity: (user) => ({ name: user.name, email: user.email }),
});
```

Without `access`, the handler keeps the shared-secret policy of `@siteping/adapter-prisma` (`apiKey`, `publicEndpoints`, `requireAuthForDestructive`, `redactUnauthenticatedEmails`).

MIT
