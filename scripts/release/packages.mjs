/**
 * Discovers public packages from the same Bun workspaces beez-rp releases.
 * @module release-packages
 */
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_MANIFEST_FILE } from "../constants/release.mjs";

/**
 * Lists non-private workspace manifests without maintaining a separate registry.
 * @param {string} repositoryRoot - Checkout containing the root package.json.
 * @returns {{ directory: string, manifest: Record<string, unknown> }[]} Public packages in directory order.
 */
export function listPublicPackages(repositoryRoot) {
  const rootManifest = JSON.parse(readFileSync(join(repositoryRoot, PACKAGE_MANIFEST_FILE), "utf8"));
  const patterns = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : rootManifest.workspaces.packages;
  return globSync(patterns, { cwd: repositoryRoot })
    .sort()
    .map((directory) => ({
      directory: directory.replaceAll("\\", "/"),
      manifest: JSON.parse(readFileSync(join(repositoryRoot, directory, PACKAGE_MANIFEST_FILE), "utf8")),
    }))
    .filter(({ manifest }) => !manifest.private);
}
