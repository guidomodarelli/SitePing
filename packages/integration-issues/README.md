[![npm version](https://img.shields.io/npm/v/@beezping/integration-issues)](https://www.npmjs.com/package/@beezping/integration-issues)
[![Docs](https://img.shields.io/badge/docs-siteping.dev-0066ff)](https://siteping.dev/docs/integrations/issues)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/integration-issues

One **GitHub** or **GitLab** issue per [SitePing](https://github.com/NeosiaNexus/SitePing) feedback — opened, closed and reopened through `@beezping/server` lifecycle hooks.

**[Documentation](https://siteping.dev/docs/integrations/issues)**

## Install

```bash
npm install @beezping/integration-issues @beezping/server
```

**Peer dependency:** `@beezping/server` · Node ≥ 20.

## Quick start

```ts
import { createSitepingHandler } from "@beezping/server";
import { createIssueTrackerHooks } from "@beezping/integration-issues";
import { createGitHubTracker } from "@beezping/integration-issues/github";

export const { GET, POST, PATCH, DELETE, OPTIONS } = createSitepingHandler({
  store,
  access,
  hooks: createIssueTrackerHooks({
    tracker: createGitHubTracker({ repository: "acme/site", token: process.env.GITHUB_TOKEN! }),
    siteUrl: "https://acme.example",
  }),
});
```

GitLab: same shape with `createGitLabTracker` from `@beezping/integration-issues/gitlab`.

## Documentation

Providers and status mapping, labels and token permissions, `siteUrl` and deep links, `redact`, `syncStatus`, custom formatting and your own `IssueTracker`: **[siteping.dev/docs/integrations/issues](https://siteping.dev/docs/integrations/issues)**.

## License

[MIT](https://github.com/NeosiaNexus/SitePing/blob/main/LICENSE)
