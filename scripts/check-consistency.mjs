#!/usr/bin/env node
// Consistency gate for the hand-maintained lists that CI cannot derive.
// Fails the build when:
//   1. a locale exists in core's BUILTIN_LOCALES without its dictionary
//      file in the widget AND dashboard i18n directories (the TS loader map
//      already enforces the loader entries at compile time);
//   2. a doc/README states a "N built-in locales" count that no longer
//      matches BUILTIN_LOCALES.length;
//   3. a published package has no CHANGELOG.md with the `## [Unreleased]`
//      block `beez-rp create-version` releases from, or lacks the
//      `prepublishOnly` guard that keeps `bun publish` from bypassing it;
//   4. a published package's build script forgot the fix-dts chain its
//      declarations need (cli is exempt: it ships no .d.ts);
//   5. the root esbuild override drifted from the widget's esbuild spec.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPublicPackages } from "./public-packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const errors = [];

// --- 1 + 2. Locales ---------------------------------------------------------

const coreTypes = read("packages/core/src/types.ts");
const localesMatch = coreTypes.match(/BUILTIN_LOCALES = \[([^\]]+)\]/);
if (!localesMatch) {
  errors.push("Could not find BUILTIN_LOCALES in packages/core/src/types.ts");
}
const locales = localesMatch ? [...localesMatch[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]) : [];

for (const code of locales) {
  if (code === "en") continue;
  for (const dir of ["packages/widget/src/i18n", "packages/dashboard/src/i18n"]) {
    if (!existsSync(join(root, dir, `${code}.ts`))) {
      errors.push(`Locale "${code}" is in BUILTIN_LOCALES but ${dir}/${code}.ts does not exist`);
    }
  }
}

/** Every file that may state a locale count. */
const localeCountFiles = ["README.md", ...readdirSync(join(root, "packages")).map((p) => `packages/${p}/README.md`)];
const walk = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".mdx") ? [`${dir}/${e.name}`] : [],
  );
if (existsSync(join(root, "apps/demo/content/docs"))) {
  localeCountFiles.push(...walk("apps/demo/content/docs"));
}

for (const file of localeCountFiles) {
  if (!existsSync(join(root, file))) continue;
  const content = read(file);
  // EN docs say "7 built-in locales", FR docs "7 locales intégrées".
  for (const m of content.matchAll(/(\d+)\s+(?:built-in locales|locales intégrées)/gi)) {
    if (Number(m[1]) !== locales.length) {
      errors.push(`${file} claims "${m[0]}" but BUILTIN_LOCALES has ${locales.length} entries`);
    }
  }
}

// --- 3. Release changelogs ---------------------------------------------------

// `bun run create-version` moves each package's `## [Unreleased]` block into
// the released version, so a package without it cannot be released.
const publicPackages = listPublicPackages().map(({ path }) => path);
const UNRELEASED_HEADING = /^## \[Unreleased\]\s*$/m;
const PUBLISH_GUARD = "beez-rp guard-publish";

for (const { path: pkgPath, manifest } of listPublicPackages()) {
  if (manifest.scripts?.prepublishOnly !== PUBLISH_GUARD) {
    errors.push(
      `${pkgPath}/package.json needs "prepublishOnly": "${PUBLISH_GUARD}" (releases go through bun run create-version)`,
    );
  }
  const changelogPath = `${pkgPath}/CHANGELOG.md`;
  if (!existsSync(join(root, changelogPath))) {
    errors.push(`${changelogPath} is missing (every published package keeps its own changelog)`);
  } else if (!UNRELEASED_HEADING.test(read(changelogPath))) {
    errors.push(`${changelogPath} has no "## [Unreleased]" block for the next release`);
  }
}

// --- 4. fix-dts chain -------------------------------------------------------

// cli ships no declarations (dts: false) — the only legitimate exemption.
const FIX_DTS_EXEMPT = new Set(["packages/cli"]);

for (const pkgPath of publicPackages) {
  if (FIX_DTS_EXEMPT.has(pkgPath)) continue;
  const pkg = JSON.parse(read(`${pkgPath}/package.json`));
  if (!pkg.scripts?.build?.includes("fix-dts.mjs")) {
    errors.push(`${pkgPath} build script is missing the fix-dts chain (tsup && node ../../scripts/fix-dts.mjs dist)`);
  }
}

// --- 5. esbuild override ----------------------------------------------------

// The root `overrides.esbuild` is the supply-chain floor for every transitive
// esbuild (#242), and it wins over packages/widget's own devDependency. When
// Dependabot bumps only the widget spec (#269), the lockfile cannot move: the
// bump lands as a no-op and every later bun update job dies on NoChangeError.
// Keeping the two specs identical makes such a PR fail here instead, so the
// override is bumped in the same PR.
const esbuildOverride = JSON.parse(read("package.json")).overrides?.esbuild;
const widgetEsbuild = JSON.parse(read("packages/widget/package.json")).devDependencies?.esbuild;
if (esbuildOverride !== widgetEsbuild) {
  errors.push(
    `root overrides.esbuild (${esbuildOverride}) must equal packages/widget devDependencies.esbuild (${widgetEsbuild}) — bump both together`,
  );
}

// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error("check-consistency: FAILED\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-consistency: OK (${locales.length} locales, ${publicPackages.length} published packages)`);
