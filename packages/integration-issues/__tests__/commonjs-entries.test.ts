import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type * as GitHubEntry from "../src/github/index.js";
import type * as GitLabEntry from "../src/gitlab/index.js";
import type * as RootEntry from "../src/index.js";
import { createFakeGitHub, createFakeGitLab } from "./fake-trackers.js";

/**
 * Runs against the published CommonJS build: `require` self-references the
 * package, so it goes through the `exports` map to `dist/*.cjs` exactly as a
 * consumer's `require()` does. Skipped until the package is built (CI and
 * `bun run verify` build first), like `test:run` elsewhere never needs a build.
 */
const requireFromPackage = createRequire(import.meta.url);
const isBuilt = existsSync(new URL("../dist/index.cjs", import.meta.url));

const FAILING_STATUS = 500;
const MARKER = "<!-- siteping-feedback";

describe.skipIf(!isBuilt)("CommonJS entries", () => {
  const root = requireFromPackage("@siteping/integration-issues") as typeof RootEntry;

  it.each([
    [
      "github",
      () => {
        const fake = createFakeGitHub("acme/site");
        fake.failWhen(/./, FAILING_STATUS);
        const { createGitHubTracker } = requireFromPackage("@siteping/integration-issues/github") as typeof GitHubEntry;
        return createGitHubTracker({ repository: "acme/site", token: "token", fetch: fake.fetch });
      },
    ],
    [
      "gitlab",
      () => {
        const fake = createFakeGitLab("acme/site");
        fake.failWhen(/./, FAILING_STATUS);
        const { createGitLabTracker } = requireFromPackage("@siteping/integration-issues/gitlab") as typeof GitLabEntry;
        return createGitLabTracker({ project: "acme/site", token: "token", fetch: fake.fetch });
      },
    ],
  ])(
    "errors thrown by the %s entry are instances of the root IssueTrackerRequestError",
    async (_provider, createTracker) => {
      const failure = await createTracker()
        .findSitepingIssues(MARKER)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(root.IssueTrackerRequestError);
      expect((failure as RootEntry.IssueTrackerRequestError).status).toBe(FAILING_STATUS);
    },
  );
});
