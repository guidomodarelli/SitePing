# @beezping/core

**Internal package** — shared types, schema, and helpers for all `@beezping/*` packages.

`private: true`, never published to npm. It exports raw TypeScript (no build step) and is bundled into consumers via `noExternal: ["@beezping/core"]` in their tsup configs — which makes it the single source of truth for:

- All shared TypeScript types (`BeezpingConfig`, `BeezpingInstance`, `FeedbackRecord`, `BeezpingStore`, …)
- Feedback statuses (`FEEDBACK_STATUSES`: `open` / `in_progress` / `resolved` / `wont_fix`) and `isClosedStatus()`
- The Prisma model definitions the CLI generates from (`BEEZPING_MODELS`)
- Store error classes (`StoreNotFoundError`, `StoreDuplicateError`, `StoreLimitError`, `StorePersistenceError`) and their guards — the guards match on `code` as well as `instanceof`, because every package bundles its own copy
- `@beezping/core/testing` — `testBeezpingStore(factory)`, the 67-test conformance suite every store adapter must pass

Consumers never install this package: everything relevant is re-exported by the published packages. End-user documentation lives at [github.com/guidomodarelli/beezping/docs](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/index.mdx).
