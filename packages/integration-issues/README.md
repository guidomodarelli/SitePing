[![npm version](https://img.shields.io/npm/v/@beezping/integration-issues)](https://www.npmjs.com/package/@beezping/integration-issues)
[![Docs](https://img.shields.io/badge/docs-github.com/guidomodarelli/beezping-0066ff)](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/issue-trackers.mdx)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

# @beezping/integration-issues

One GitHub or GitLab issue per [Beezping](https://github.com/guidomodarelli/beezping) feedback, opened, closed and reopened along with it through `@beezping/server` lifecycle hooks. No database column: the issue's first line links it to its feedback. Any other tracker plugs in through the `IssueTracker` interface.

**[Documentation](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/issue-trackers.mdx)**

## Install

```bash
npm install @beezping/integration-issues
```

Node ≥ 20, or any runtime with the Fetch API. `@beezping/server` is a peer dependency.

## Quick start

```ts
import { createBeezpingHandler } from "@beezping/server";
import { createIssueTrackerHooks } from "@beezping/integration-issues";
import { createGitHubTracker } from "@beezping/integration-issues/github";
// or: import { createGitLabTracker } from "@beezping/integration-issues/gitlab";

export const { GET, POST, PATCH, DELETE, OPTIONS } = createBeezpingHandler({
  store,
  apiKey: process.env.BEEZPING_API_KEY,
  hooks: createIssueTrackerHooks({
    tracker: createGitHubTracker({ repository: "acme/site", token: process.env.GITHUB_TOKEN! }),
    siteUrl: "https://acme.com", // resolves the page paths the widget records
  }),
});
```

## Documentation

Token permissions, the status mapping, what an issue contains, failure handling and custom trackers: **[github.com/guidomodarelli/beezping/docs/issue-trackers](https://github.com/guidomodarelli/beezping/tree/main/apps/demo/content/docs/issue-trackers.mdx)**.

## License

[MIT](https://github.com/guidomodarelli/beezping/blob/main/LICENSE)
