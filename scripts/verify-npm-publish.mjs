#!/usr/bin/env node
// Post-release guard: each public workspace version must exist on npm.
// Retries absorb registry read-after-publish lag; beez-rp resumes missing
// publications from their release commits when create-version runs again.
// Usage: node scripts/verify-npm-publish.mjs
// Env: VERIFY_PUBLISH_ATTEMPTS (default 4), VERIFY_PUBLISH_DELAY_MS (20000).

import { appendFileSync } from "node:fs";
import { lookupPublishedVersions, resolvePublishRegistry } from "beez-rp/create-version";
import { listPublicPackages } from "./release/packages.mjs";

// CI-only knobs — this script never runs through a turbo task, so declaring
// them in turbo.json (what noUndeclaredEnvVars asks for) would be wrong.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: not a turbo task input
const attempts = Number(process.env.VERIFY_PUBLISH_ATTEMPTS ?? 4);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: not a turbo task input
const delayMs = Number(process.env.VERIFY_PUBLISH_DELAY_MS ?? 20_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks the package's resolved registry for the exact committed version.
 * @param {{ name: string, version: string, registryUrl: string }} target - Publication target.
 * @returns {Promise<boolean>} Whether npm confirms this version.
 */
async function isPublished({ name, version, registryUrl }) {
  const result = await lookupPublishedVersions(name, process.cwd(), registryUrl);
  return result.publishedVersions?.includes(version) ?? false;
}

const targets = [];
for (const { manifest } of listPublicPackages(process.cwd())) {
  if (manifest.version === "0.0.0") continue;
  targets.push({
    name: manifest.name,
    version: manifest.version,
    registryUrl: await resolvePublishRegistry(manifest, process.cwd()),
  });
}

let missing = targets;
for (let attempt = 1; attempt <= attempts && missing.length > 0; attempt++) {
  if (attempt > 1) {
    console.log(`Retrying ${missing.length} package(s) in ${delayMs / 1000}s (attempt ${attempt}/${attempts})…`);
    await sleep(delayMs);
  }
  const results = await Promise.all(missing.map(async (target) => ({ target, published: await isPublished(target) })));
  missing = results.filter(({ published }) => !published).map(({ target }) => target);
}

const rows = targets.map(({ name, version }) => {
  const ok = !missing.some((m) => m.name === name);
  console.log(`${ok ? "OK     " : "MISSING"} ${name}@${version}`);
  return `| ${name} | ${version} | ${ok ? "✅ published" : "❌ missing"} |`;
});

// biome-ignore lint/suspicious/noUndeclaredEnvVars: GitHub Actions built-in, not a turbo task input
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary) {
  appendFileSync(
    stepSummary,
    `## npm publish verification\n\n| Package | Workspace version | npm |\n|---|---|---|\n${rows.join("\n")}\n`,
  );
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} workspace version(s) missing from npm — a tag/release exists without its publication (issue #184).\n` +
      "Rescue: rerun bun run create-version to resume pending publications.",
  );
  process.exit(1);
}
console.log(`\nAll ${targets.length} workspace versions are live on npm.`);
