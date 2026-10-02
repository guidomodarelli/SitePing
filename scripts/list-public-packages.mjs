#!/usr/bin/env node
// Prints the repo-relative directory of every published package, one per
// line — discovered from Bun workspaces, just like beez-rp. CI loops
// (publint/attw, pkg-pr-new) and
// scripts/pkg-checks.mjs consume this instead of hand-maintained lists, so
// a new package can no longer be silently skipped by a gate.

import { fileURLToPath } from "node:url";
import { listPublicPackages } from "./release/packages.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

for (const { directory } of listPublicPackages(repositoryRoot)) {
  console.log(directory);
}
