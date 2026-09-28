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

### Cookie sessions across origins

With `allowedOrigins`, responses carry `Access-Control-Allow-Credentials: true` for the listed origins, so an `access.authenticate` that reads a session cookie works cross-origin — but only if the browser actually sends the cookie. `fetch` defaults to `credentials: "same-origin"`, so opt in on the client:

```ts
// Widget on https://client-site.com, API on another origin
initSiteping({ endpoint: "https://api.example.com/api/siteping", projectName: "my-site", credentials: "include" });

// Dashboard (endpoint mode)
<SitepingInbox projects="my-site" endpoint="https://api.example.com/api/siteping" credentials="include" />
```

The session cookie must be issued with `SameSite=None; Secure` to travel cross-site. Without `credentials: "include"` the cookie never reaches `authenticate` and every request is rejected with `401`. Keep `allowedOrigins` to origins you trust: it is the CSRF boundary for cookie-authenticated requests.

### CSRF protection

CORS only hides responses from foreign pages; it does not stop a browser from *sending* a credentialed request. So `POST`, `PATCH` and `DELETE` go through two checks before the body is parsed, `authenticate` runs or any hook fires:

- **Origin allowlist.** When `allowedOrigins` is set, a mutation whose `Origin` header is neither listed nor the endpoint's own origin (including the opaque `null` origin) answers `403 { error: "Forbidden" }` and is logged with its method, path and truncated origin. Requests without an `Origin` header (server-to-server calls, curl) are let through — browsers always send one on cross-origin mutations. Behind a proxy that rewrites `request.url`, list your public origin in `allowedOrigins` so same-origin calls still match.
- **JSON only.** A mutation must declare `Content-Type: application/json` (parameters such as `charset` are fine), otherwise it answers `415`. That content type is not CORS-safelisted, so a cross-origin browser must pass a preflight first — a forged `text/plain` form or `fetch` never reaches the handler. The widget and the dashboard always send it.

Without `access`, the handler keeps the shared-secret policy of `@siteping/adapter-prisma` (`apiKey`, `publicEndpoints`, `requireAuthForDestructive`, `redactUnauthenticatedEmails`).

MIT
