/**
 * Defines release packaging contracts shared by repository tooling.
 * @module release-constants
 */

/** Dependency fields that consumers install from the published manifest. */
export const PUBLISHED_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
/** Filename shared by npm packages and Bun workspaces. */
export const PACKAGE_MANIFEST_FILE = "package.json";
/** Package changelog filename used by beez-rp. */
export const CHANGELOG_FILE = "CHANGELOG.md";
/** Prefix identifying package-manager-only dependency specifiers. */
export const WORKSPACE_PROTOCOL = "workspace:";
/** Disposable archive directory prefix, outside the Git checkout. */
export const RELEASE_ARCHIVE_PREFIX = "beezping-release-";
/** Archive filename passed to npm, independent of scoped package names. */
export const RELEASE_ARCHIVE_FILE = "package.tgz";
/** Package copy whose manifest can be rewritten without changing the checkout. */
export const PACKAGE_STAGING_DIRECTORY = "package";
/** Workspace shorthand ranges, resolved against manifests of the release commit. */
export const WORKSPACE_RANGE_PREFIXES = new Map([
  ["*", ""],
  ["^", "^"],
  ["~", "~"],
]);
