/**
 * Publishes Bun-packed workspaces through beez-rp's npm authentication boundary.
 * @module release-publish
 */
import { rmSync } from "node:fs";
import { buildNpmAuthConfigLine, publishToNpm, ReleaseStepError } from "beez-rp/create-version";
import { assertPublicationAccess } from "./auth.mjs";
import { packWorkspaceRelease } from "./pack.mjs";
import { listPublicPackages } from "./packages.mjs";

/**
 * Publishes exactly one release; beez-rp orders packages and resumes confirmed publications.
 * @param {import("beez-rp/create-version").HookContext} context - Release checkout and package identity.
 * @param {string} [credentialsRoot] - Original checkout retaining untracked .env and .npmrc on resume.
 * @returns {Promise<void>}
 * @throws {ReleaseStepError} When packing, credentials or npm publication fail.
 */
export async function publishWorkspacePackage({ repositoryRoot, releases }, credentialsRoot = repositoryRoot) {
  const release = releases?.[0];
  if (!release || releases.length !== 1) {
    throw new ReleaseStepError(
      "The workspace publisher requires exactly one release.",
      "Run it through bun run create-version.",
    );
  }
  const publicPackage = listPublicPackages(repositoryRoot).find(({ directory }) => directory === release.directory);
  if (!publicPackage) {
    throw new ReleaseStepError(
      `Public package ${release.name} was not found in ${release.directory}.`,
      "Restore the release checkout and retry.",
    );
  }
  const registryUrl = await assertPublicationAccess(credentialsRoot, publicPackage.manifest);
  const archive = packWorkspaceRelease(repositoryRoot, release);
  try {
    const result = await publishToNpm(credentialsRoot, {
      authConfigLine: buildNpmAuthConfigLine(registryUrl),
      packageRoot: archive.directory,
      artifactPath: archive.filename,
      registryUrl,
    });
    if (result.exitCode !== 0) {
      throw new ReleaseStepError(
        `npm publish failed for ${release.name}@${release.version} (exit ${result.exitCode}).`,
        "The release tags are already pushed. Rerun bun run create-version to resume pending publications.",
      );
    }
  } finally {
    rmSync(archive.directory, { recursive: true, force: true });
  }
}
