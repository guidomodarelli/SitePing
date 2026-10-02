/**
 * Configures independent Beezping releases while preserving existing package tags.
 * @module beez-rp-config
 */
import { fileURLToPath } from "node:url";
import { publishWorkspacePackage } from "./scripts/release/publish.mjs";

/** Original checkout used for credentials, including resumed temporary worktrees. */
const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

/** @type {import("beez-rp/create-version").CreateVersionConfig} */
export default {
  projectName: "Beezping",
  packages: "workspaces",
  tagFormat: "{component}-v{version}",
  preMajorShift: true,
  changelog: { audience: "developers consuming {name}", language: "en" },
  registry: "npm",
  checks: ["node scripts/release/preflight.mjs", "bun run verify", "bun run check:consistency", "bun run test:release"],
  prepare: ["bun install --frozen-lockfile", "bun run build", "bun run pkg-checks"],
  publish: (context) => publishWorkspacePackage(context, repositoryRoot),
  versionFiles: ["packages/cli/src/index.ts"],
};
