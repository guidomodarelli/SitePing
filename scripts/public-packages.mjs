// The published packages: every workspace with a package.json that is not
// `private` — the same rule `beez-rp create-version` uses to decide what it
// versions, tags and publishes. Gates (pkg-checks, check-consistency) and CI
// loops read this list instead of a hand-maintained one, so a new package can
// never be silently skipped.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Workspace globs this repo uses: a parent directory followed by `/*`. */
const WORKSPACE_GLOB_SUFFIX = "/*";

/**
 * @returns {{ path: string, manifest: Record<string, any> }[]} Repo-relative
 *   directory and package.json of every published package, sorted by path.
 */
export function listPublicPackages() {
  const { workspaces = [] } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return workspaces
    .flatMap((pattern) => {
      if (!pattern.endsWith(WORKSPACE_GLOB_SUFFIX)) {
        throw new Error(`public-packages: unsupported workspace pattern "${pattern}" (expected "<dir>/*")`);
      }
      const parent = pattern.slice(0, -WORKSPACE_GLOB_SUFFIX.length);
      return readdirSync(join(root, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, "package.json")))
        .map((entry) => `${parent}/${entry.name}`);
    })
    .map((path) => ({ path, manifest: JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")) }))
    .filter(({ manifest }) => manifest.name && !manifest.private)
    .sort((left, right) => left.path.localeCompare(right.path));
}
