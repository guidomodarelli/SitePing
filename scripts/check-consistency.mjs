#!/usr/bin/env node
// Consistency gate for the hand-maintained lists that CI cannot derive.
// Fails the build when:
//   1. a locale exists in core's BUILTIN_LOCALES without its dictionary
//      file in the widget AND dashboard i18n directories (the TS loader map
//      already enforces the loader entries at compile time);
//   2. a doc/README/landing page states a "N built-in locales" count that
//      no longer matches BUILTIN_LOCALES.length or lists the locales without
//      one of them, or a demo locale picker does not offer exactly
//      BUILTIN_LOCALES;
//   3. a public workspace is missing its beez-rp changelog or build script;
//   4. a published package's build script forgot the fix-dts chain its
//      declarations need (cli is exempt: it ships no .d.ts);
//   5. the root esbuild override drifted from the widget's esbuild spec;
//   6. Node tooling (configs, scripts/, e2e/) takes a filesystem path from a
//      file URL's .pathname instead of fileURLToPath();
//   7. adapter-prisma's source imports @prisma/client, which it declares as
//      an optional peer dependency;
//   8. a published workspace depends on a private or missing workspace.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readUnreleased } from "beez-rp/changelog";
import { PUBLISHED_DEPENDENCY_FIELDS, WORKSPACE_PROTOCOL } from "./constants/release.mjs";
import { listPublicPackages } from "./release/packages.mjs";

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

/** Every file that may state a locale count or list the locales. */
const localeDocFiles = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "packages/core/src/types.ts",
  ...readdirSync(join(root, "packages")).map((p) => `packages/${p}/README.md`),
];
const walk = (dir, ext) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`, ext) : e.name.endsWith(ext) ? [`${dir}/${e.name}`] : [],
  );
for (const [dir, ext] of [
  ["apps/demo/content/docs", ".mdx"],
  ["apps/demo/src", ".tsx"],
]) {
  if (existsSync(join(root, dir))) localeDocFiles.push(...walk(dir, ext));
}

const englishName = new Intl.DisplayNames(["en"], { type: "language" });
// A standalone code or name: `fr` or "French", not the fr of fr-CA or fr_FR.
const mentionRe = (word) =>
  new RegExp(`(?<![\\p{L}\\p{N}_-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "gu");
// What separates two entries of a locale list: a closing backtick or
// parenthesis, an optional note ("(default)", "(`fr`)"), a comma and/or
// "and"/"et", then the words that may lead the next entry ("French (`fr`)",
// "Brazilian Portuguese").
const LIST_SEPARATOR =
  /^[`)]*(?:\s*\([^()\n]*\))?\s*(?:,\s*(?:(?:and|et)\s+)?|(?:and|et)\s+)(?:[\p{L} ]+\(|\p{Lu}\p{L}*\s)?`?$/u;

for (const file of localeDocFiles) {
  if (!existsSync(join(root, file))) continue;
  const content = read(file);
  // EN docs say "7 built-in locales", FR docs "7 locales intégrées", the root
  // README "7 locales", the landing page "7 languages built in".
  for (const m of content.matchAll(/(\d+)\s+(?:(?:built-in\s+)?locales\b|languages built in)/gi)) {
    if (Number(m[1]) !== locales.length) {
      errors.push(`${file} claims "${m[0]}" but BUILTIN_LOCALES has ${locales.length} entries`);
    }
  }
  // Locale codes (`fr`) or English names (French) chained by list separators
  // form a locale list. A list that names most built-in locales enumerates
  // them, so it must name every one; a shorter one ("`fr` and `ru`") is an
  // example.
  for (const name of [(code) => code, (code) => englishName.of(code)]) {
    const mentions = locales
      .flatMap((code) =>
        [...content.matchAll(mentionRe(name(code)))].map((m) => ({ code, index: m.index, end: m.index + m[0].length })),
      )
      .sort((a, b) => a.index - b.index);
    const lists = [];
    for (const [i, { code, index }] of mentions.entries()) {
      if (i > 0 && LIST_SEPARATOR.test(content.slice(mentions[i - 1].end, index))) lists.at(-1).codes.add(code);
      else lists.push({ index, codes: new Set([code]) });
    }
    for (const { index, codes } of lists) {
      if (codes.size * 2 <= locales.length) continue;
      const missing = locales.filter((code) => !codes.has(code));
      if (missing.length > 0) {
        const line = content.slice(0, index).split("\n").length;
        errors.push(`${file}:${line} lists the built-in locales without ${missing.map(name).join(", ")}`);
      }
    }
  }
}

// The demo's locale pickers are hand-written lists (each option carries its
// native label), so each must offer exactly the built-in set.
for (const file of [
  "apps/demo/src/app/(site)/demo/playground.tsx",
  "apps/demo/src/app/(site)/demo/inbox/demo-inbox.tsx",
]) {
  const list = existsSync(join(root, file)) ? read(file).match(/const LOCALES = \[([\s\S]*?)\] as const;/) : null;
  if (!list) {
    errors.push(`Could not find the LOCALES picker list in ${file}`);
    continue;
  }
  const codes = [...list[1].matchAll(/(?:code: |\[)"([a-z-]+)"/g)].map((m) => m[1]);
  if ([...codes].sort().join() !== [...locales].sort().join()) {
    errors.push(`${file} offers the locales [${codes.join(", ")}] but BUILTIN_LOCALES is [${locales.join(", ")}]`);
  }
}

// --- 3. Workspace release metadata -----------------------------------------

const publicPackages = listPublicPackages(root);
const manifest = Object.fromEntries(publicPackages.map(({ directory, manifest: pkg }) => [directory, pkg.version]));

for (const { directory, manifest: pkg } of publicPackages) {
  const changelogPath = `${directory}/CHANGELOG.md`;
  if (!existsSync(join(root, changelogPath))) {
    errors.push(`${changelogPath} is required by beez-rp`);
    continue;
  }
  const unreleased = readUnreleased(read(changelogPath));
  if (!unreleased.exists || unreleased.unknownSections.length > 0) {
    errors.push(`${changelogPath} needs [Unreleased] with Keep a Changelog sections`);
  }
  if (!pkg.scripts?.build) errors.push(`${directory} has no release build script`);
}

// --- 4. fix-dts chain -------------------------------------------------------

// cli ships no declarations (dts: false) — the only legitimate exemption.
const FIX_DTS_EXEMPT = new Set(["packages/cli"]);

for (const pkgPath of Object.keys(manifest)) {
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

// --- 6. File-URL paths in tooling -------------------------------------------

// A file URL's `.pathname` is not a filesystem path: it stays percent-encoded
// ("Mes%20projets", "D%C3%A9veloppement") and, on Windows, keeps a slash in
// front of the drive ("/C:/...", which Node resolves to "C:\C:\..."). Every
// CI job runs on ubuntu-latest from a plain path, where both give the same
// string, so nothing else in CI can catch a regression of #334.
// fileURLToPath() is right on every platform.
//
// Scanned: what Node runs as tooling, i.e. the top-level files of the root
// and of each workspace (configs, presets), their scripts/ dirs, and e2e/.
// Unit tests are out on purpose: their `vi.mock(new URL(…).pathname)` ids
// are Vite module ids, not fs paths, and they resolve under jsdom (which every
// file using them runs in). A relative specifier would be the sturdier form;
// fileURLToPath() can't be used there, as vi.mock is hoisted above imports.
// `,?` matches biome's multi-line call form, `\)+` a parenthesised
// `(new URL(…)).pathname`, `\??` an optional-chained `?.pathname`.
const FILE_URL_PATHNAME = /import\.meta\.url\s*,?\s*\)+\s*\??\.pathname/g;
const workspaceDirs = JSON.parse(read("package.json")).workspaces.flatMap((glob) => {
  if (!glob.endsWith("/*")) return [glob];
  const parent = glob.slice(0, -2);
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${parent}/${e.name}`);
});
const toolingDirs = [".", "scripts", "e2e", ...workspaceDirs, ...workspaceDirs.map((w) => `${w}/scripts`)];
let toolingFiles = 0;

for (const dir of toolingDirs) {
  if (!existsSync(join(root, dir))) continue;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
    const file = dir === "." ? entry.name : `${dir}/${entry.name}`;
    const content = read(file);
    toolingFiles++;
    for (const m of content.matchAll(FILE_URL_PATHNAME)) {
      const line = content.slice(0, m.index).split("\n").length;
      errors.push(
        `${file}:${line} takes a filesystem path from a file URL's .pathname — use fileURLToPath() (node:url)`,
      );
    }
  }
}

// --- 7. @prisma/client stays an optional peer --------------------------------

// Stores other than Prisma mount through adapter-prisma too, so its
// @prisma/client peer is optional (#306): npm, pnpm and Bun then leave it
// out. That is only safe while the source never imports it — not even as a
// type, which would leave an import the consumer may not resolve in the
// published declarations. The client shape is structural on purpose
// (BeezpingPrismaClient).
const PRISMA_CLIENT_IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']@prisma\/client(?:\/[^"']*)?["']/;
const prismaSourceFiles = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? prismaSourceFiles(`${dir}/${e.name}`) : /\.[cm]?tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
for (const file of prismaSourceFiles("packages/adapter-prisma/src")) {
  if (PRISMA_CLIENT_IMPORT.test(read(file))) {
    errors.push(`${file} imports @prisma/client — adapter-prisma declares it as an optional peer (#306)`);
  }
}

// --- 8. Published workspace dependencies must be public ---------------------

const publicNames = new Set(publicPackages.map(({ manifest: pkg }) => pkg.name));
for (const { directory, manifest: pkg } of publicPackages) {
  for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
    for (const [name, specifier] of Object.entries(pkg[field] ?? {})) {
      if (specifier.startsWith(WORKSPACE_PROTOCOL) && !publicNames.has(name)) {
        errors.push(`${directory} ${field}.${name} refers to a private or missing workspace`);
      }
    }
  }
}

// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error("check-consistency: FAILED\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-consistency: OK (${locales.length} locales, ${Object.keys(manifest).length} published packages, ${toolingFiles} tooling files)`,
);
