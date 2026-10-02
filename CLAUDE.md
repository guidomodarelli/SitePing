# @beezping/*

## Build & Test
- `bun install` — install dependencies (bun workspaces)
- `bun run build` — build all packages via Turborepo + tsup (cached)
- `bun run check` — TypeScript type-checking, src AND __tests__ (cached)
- `bun run clean` — clean all dist/ directories
- `bun run test` — run tests in watch mode
- `bun run test:run` — run tests once (includes *.test-d.ts type tests via vitest typecheck)
- `bun run lint` — biome check (types domain enabled)
- `bun run lint:fix` — biome auto-fix
- `bun run verify` — build + check + lint + test:run (the full pre-PR gate)
- `bun run pkg-checks` — publint + attw over published packages (list discovered from Bun workspaces)
- `bun run check:consistency` — locale counts and lists, demo locale pickers, package registration, fix-dts chains, esbuild override = widget spec, `fileURLToPath` (never a file URL's `.pathname`) in Node tooling, no `@prisma/client` import in adapter-prisma's src (optional peer), every published `workspace:` dependency points to a public workspace (runs in CI)
- `bun run new:locale <code>` / `bun run new:adapter <name>` — scaffolds (see CONTRIBUTING)

## Releases
- `bun run create-version --dry-run` — diagnose and plan independent workspace releases without writes
- `bun run create-version` / `bun run cv --accept-suggested` — release from clean main through beez-rp
- `bun run test:release` — real Git, Bun packing and local-registry release tests
- `beez-rp.config.js` preserves component tags, pre-1.0 suggestions and the CLI version marker. Public packages are discovered from workspaces; no separate release registry.
- Keep package notes under `[Unreleased]` with Keep a Changelog sections. Existing history stays intact.
- Packaging resolves `workspace:` from release manifests in a temporary copy, then Bun packs it; npm publishes with beez-rp auth. Tracked manifests remain unchanged.
- The Release workflow is manually dispatched (dry-run by default); push to main only runs CI. The main push reconciles package tags into GitHub releases after CI.

## Architecture
- **Monorepo** with bun workspaces — 12 packages in `packages/`:
  - `@beezping/core` — shared types, schema, store errors + helpers (internal, not published, excluded from beez-rp releases)
  - `@beezping/widget` — browser feedback widget (Shadow DOM, closed mode). Accepts `store` option for client-side mode (no server needed)
  - `@beezping/dashboard` — Linear-style triage inbox React component (`<BeezpingInbox />` + headless `useBeezpingInbox()`); no Shadow DOM — scoped `spd-` classes + `--spd-*` CSS vars injected once
  - `@beezping/server` — store-agnostic HTTP handler (`createBeezpingHandler({ store })`, Fetch API, platform neutral): `apiKey` policy XOR custom `access` (CSRF guards), hooks, `waitUntil`; owns the request schemas and webhooks
  - `@beezping/adapter-prisma` — PrismaStore + `createBeezpingHandler` delegating to `@beezping/server` (`workspace:^` dependency, resolved by Bun when packing; beez-rp publishes server first); `@prisma/client` optional peer
  - `@beezping/adapter-drizzle` — Drizzle ORM store: `/pg` (any PostgreSQL driver, Neon HTTP included) and `/libsql` (Turso); `drizzle-orm` peer, mounted through `@beezping/server`
  - `@beezping/screenshot-storage` — ready-made `ScreenshotStorage` for the stores: `createScreenshotStorage(objectStore)` over `/s3` (SigV4 on Web Crypto, no AWS SDK), `/cloudflare-images`, `/drizzle-pg`, `/drizzle-libsql`, `/filesystem` (the only Node entry) and `/memory`, plus `createScreenshotServeHandler` (own keys only, inert images inline); random key per upload, `drizzle-orm` optional peer
  - `@beezping/integration-issues` — `createIssueTrackerHooks` (server lifecycle hooks) over an `IssueTracker` port, providers `/github` and `/gitlab`: one issue per feedback, linked by a marker on the body's first line (the only line parsed), visitor text quoted as code; `@beezping/server` peer (`>=0.2.0 <1.0.0`; beez-rp publishes server first)
  - `@beezping/adapter-memory` — in-memory adapter (testing, demos, serverless)
  - `@beezping/adapter-localstorage` — client-side localStorage adapter (demos, prototyping)
  - `@beezping/adapter-kit` — published toolkit for third-party adapters: store contract, `createCollectionStore` engine, record builders, conformance suite (`/testing`, vitest optional peer)
  - `@beezping/cli` — CLI tool for project setup (`npx @beezping/cli init/sync/status/doctor` — there is no bare `beezping` package on npm)
- Widget uses Shadow DOM (mode: closed), overlay lives outside Shadow DOM
- DOM anchoring: @medv/finder CSS selector + XPath fallback + text snippet fallback
- Annotations stored as % relative to anchor element bounding box
- Core is an Internal Package (exports raw TS, no build step), bundled into consumers via `noExternal: ["@beezping/core"]` in tsup
- Turborepo handles build orchestration, dependency ordering (`^build`), and local caching
- **Docs site** — `apps/demo` (private, Next.js) serves github.com/guidomodarelli/beezping: landing, `/demo`, and `/docs` (Fumadocs). Pages are MDX in `apps/demo/content/docs/`; EN at bare URLs, other locales prefixed (`/fr/docs/...`), `.fr.mdx` siblings + `meta.fr.json` for sidebar labels, `fallbackLanguage: "en"`. **Docs are written from the source code, never copied from a README** — package READMEs are thin npm cards pointing at the site. Sitemap, search index, and hreflang are all derived from the content tree. See CONTRIBUTING.md "Editing the Documentation".

## Code Style
- TypeScript strict mode with exactOptionalPropertyTypes
- Conventional Commits: `type(scope): description`
- i18n: built-in locales = en (default), fr, de, es, it, pt (Brazilian), ru, ja — same set in widget and dashboard (each has its own `src/i18n/`). Primary audience is French freelance clients; other locales are community contributions. See CONTRIBUTING.md "Adding a Locale" before adding more.
- Feedback statuses: `open` / `in_progress` / `resolved` / `wont_fix` (`FEEDBACK_STATUSES` in core). `resolvedAt` = closure timestamp for `resolved` AND `wont_fix` (`isClosedStatus()`), derived at the edge via `toFeedbackUpdate(status)` (HTTP handler / dashboard), never inside store adapters. `FeedbackUpdateInput` is a union enforcing the pairing. Widget actions stay binary (resolve/reopen).
- Key type contracts (compile locks + `*.test-d.ts`): `BeezpingConfig` = HTTP XOR store union; dashboard options = source/store/endpoint XOR union; `FeedbackResponse` derived from `FeedbackRecord` via `Serialized<T>` (never hand-write wire types); `BEEZPING_MODELS` locked to record keys; adding a locale to `BUILTIN_LOCALES` breaks compilation until both packages' loader maps + dictionaries exist.
