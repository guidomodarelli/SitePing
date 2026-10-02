/**
 * Extracts published notes while retaining historical release-please headings.
 * @module release-notes
 */

/**
 * Reads the body of a released changelog version, accepting both heading formats.
 * @param {string} changelog - Package changelog contents.
 * @param {string} version - Stable package version.
 * @returns {string} Markdown body of the requested version.
 * @throws {Error} When no notes exist for that version.
 */
export function readReleaseNotes(changelog, version) {
  const blocks = changelog.split(/^## /m).slice(1);
  const block = blocks.find(
    (candidate) => candidate.startsWith(`[${version}]`) || candidate.startsWith(`${version} - `),
  );
  const body = block?.slice(block.indexOf("\n") + 1).trim();
  if (!body) throw new Error(`No changelog notes found for version ${version}.`);
  return body;
}
