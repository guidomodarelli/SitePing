/**
 * Builds npm-installable archives with Bun's workspace range rewriting.
 * @module release-pack
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ReleaseStepError } from "beez-rp/create-version";
import {
  PACKAGE_MANIFEST_FILE,
  PACKAGE_STAGING_DIRECTORY,
  PUBLISHED_DEPENDENCY_FIELDS,
  RELEASE_ARCHIVE_FILE,
  RELEASE_ARCHIVE_PREFIX,
  WORKSPACE_PROTOCOL,
  WORKSPACE_RANGE_PREFIXES,
} from "../constants/release.mjs";
import { listPublicPackages } from "./packages.mjs";

/**
 * Packs a release from its checkout without editing tracked files or running lifecycle scripts.
 * @param {string} repositoryRoot - Checkout prepared by beez-rp.
 * @param {{ name: string, version: string, directory: string }} release - Expected release identity.
 * @returns {{ directory: string, filename: string }} Temporary directory and archive filename; caller removes it.
 * @throws {ReleaseStepError} When the checkout is dirty, the identity differs or Bun cannot pack it.
 */
export function packWorkspaceRelease(repositoryRoot, release) {
  const publicPackages = listPublicPackages(repositoryRoot);
  const publicPackage = publicPackages.find(({ directory }) => directory === release.directory);
  if (
    !publicPackage ||
    publicPackage.manifest.name !== release.name ||
    publicPackage.manifest.version !== release.version
  ) {
    throw new ReleaseStepError(
      `Release identity differs for ${release.name}@${release.version} (${release.directory}).`,
      "Restore the release checkout before retrying bun run create-version.",
    );
  }
  const trackedChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (trackedChanges.trim()) {
    throw new ReleaseStepError(
      `Tracked files changed before packing ${release.name}@${release.version}.`,
      "Commit or stash the changes before retrying bun run create-version.",
    );
  }
  const directory = mkdtempSync(join(tmpdir(), RELEASE_ARCHIVE_PREFIX));
  try {
    const stagingRoot = join(directory, PACKAGE_STAGING_DIRECTORY);
    cpSync(join(repositoryRoot, release.directory), stagingRoot, {
      recursive: true,
      filter: (sourcePath) => !["node_modules", ".git"].includes(basename(sourcePath)),
    });
    const manifest = structuredClone(publicPackage.manifest);
    const versions = new Map(publicPackages.map(({ manifest: pkg }) => [pkg.name, pkg.version]));
    for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (!specifier.startsWith(WORKSPACE_PROTOCOL)) continue;
        const prefix = WORKSPACE_RANGE_PREFIXES.get(specifier.slice(WORKSPACE_PROTOCOL.length));
        if (prefix === undefined || !versions.has(name)) {
          throw new ReleaseStepError(
            `Cannot resolve ${field}.${name} (${specifier}) for ${release.name}.`,
            "Use a public workspace and a workspace:*, workspace:^ or workspace:~ range.",
          );
        }
        manifest[field][name] = `${prefix}${versions.get(name)}`;
      }
    }
    // Private build dependencies are bundled, never installed by consumers.
    delete manifest.devDependencies;
    writeFileSync(join(stagingRoot, PACKAGE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync(
      "bun",
      ["pm", "pack", "--filename", join(directory, RELEASE_ARCHIVE_FILE), "--ignore-scripts", "--quiet"],
      {
        cwd: stagingRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { directory, filename: RELEASE_ARCHIVE_FILE };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw new ReleaseStepError(
      `Bun could not pack ${release.name}@${release.version}.`,
      "Check the package files and rerun bun run create-version.",
      { cause: error },
    );
  }
}
