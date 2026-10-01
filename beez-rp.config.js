/**
 * @file Configuration of `beez-rp create-version` (`bun run create-version`, alias `bun run cv`).
 *
 * Every workspace that is not `private` is released on its own: its version,
 * its `CHANGELOG.md` (`## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD`), its tag
 * (`widget-v0.11.0`, same format release-please used) and its npm publication.
 * A package is released when a commit touched its folder or the folder of a
 * private package it bundles (`@beezping/core`). All the versions go in one
 * `release: …` commit on `main`, pushed with its tags atomically, and each
 * package is published with npm from its folder, in dependency order.
 */

/** @type {import("beez-rp/create-version").CreateVersionConfig} */
export default {
  projectName: "SitePing",
  changelog: { audience: "developers using {name}", language: "en" },
  releaseTypeDescriptions: {
    patch: "Fixes and internal changes; on 0.x, also new backwards-compatible features.",
    minor: "New backwards-compatible features; on 0.x, breaking changes.",
    major: "Breaking changes consumers must adapt to (from 0.x, the 1.0.0 release).",
  },
  // 0.x convention, as release-please did: breaking → minor, features → patch.
  preMajorShift: true,
  packages: "workspaces",
  // The same gates CI runs on every PR, before any version changes.
  checks: ["bun run verify", "bun run check:consistency", "bun run pkg-checks"],
  // Rebuilds on the release commit, so each dist/ carries its new version
  // (the CLI prints the one written into packages/cli/src/index.ts).
  prepare: ["bun install --frozen-lockfile", "bun run build"],
  publish: "npm",
  versionFiles: ["packages/cli/src/index.ts"],
};
