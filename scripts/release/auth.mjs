/**
 * Reuses beez-rp's token resolution and registry diagnostics for the custom publisher.
 * @module release-auth
 */
import { NPM_AUTH_STATUS } from "beez-rp/constants";
import {
  checkNpmPublishAccess,
  describeNpmAuthProblem,
  ReleaseStepError,
  resolvePublishRegistry,
} from "beez-rp/create-version";

/**
 * Checks publication access using environment, repository or shared beez-rp credentials.
 * @param {string} repositoryRoot - Checkout resolving npm configuration and credentials.
 * @param {Record<string, unknown>} manifest - Public workspace manifest.
 * @returns {Promise<string>} Resolved registry URL.
 * @throws {ReleaseStepError} When credentials are missing, rejected or cannot be diagnosed.
 */
export async function assertPublicationAccess(repositoryRoot, manifest) {
  const registryUrl = await resolvePublishRegistry(manifest, repositoryRoot);
  const auth = await checkNpmPublishAccess(manifest.name, repositoryRoot, registryUrl);
  const problem = describeNpmAuthProblem(auth);
  if (problem || auth.status === NPM_AUTH_STATUS.unknown) {
    throw new ReleaseStepError(
      `npm access check failed for ${manifest.name}: ${problem?.title ?? "registry access could not be confirmed"}.`,
      "Check NPM_TOKEN and npm registry access, then rerun bun run create-version.",
    );
  }
  return registryUrl;
}
