#!/usr/bin/env node
// Package-health gate: publint (packaging mistakes) + attw --pack (type
// resolution across module systems) over every published package. Runs the
// pinned local binaries, so `bun run pkg-checks` reproduces exactly what CI
// enforces. Requires a prior `bun run build`.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listPublicPackages } from "./release/packages.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const packages = listPublicPackages(repositoryRoot).map(({ directory }) => directory);

let failed = false;

for (const pkg of packages) {
  for (const [label, bin, args] of [
    ["publint", "node", ["node_modules/publint/src/cli.js", pkg]],
    ["attw", "node", ["node_modules/@arethetypeswrong/cli/dist/index.js", pkg, "--pack"]],
  ]) {
    console.log(`\n=== ${label} ${pkg} ===`);
    try {
      execFileSync(bin, args, { stdio: "inherit" });
    } catch {
      failed = true;
    }
  }
}

if (failed) {
  console.error("\npkg-checks: FAILED — see output above.");
  process.exit(1);
}
console.log("\npkg-checks: all packages healthy.");
