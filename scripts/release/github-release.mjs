/**
 * Creates a GitHub release from the tagged package's committed changelog.
 * @file github-release
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CHANGELOG_FILE, RELEASE_ARCHIVE_PREFIX } from "../constants/release.mjs";
import { readReleaseNotes } from "./notes.mjs";
import { listPublicPackages } from "./packages.mjs";

const tag = process.argv[2];
const publicPackage = listPublicPackages(process.cwd()).find(
  ({ directory, manifest }) => tag === `${basename(directory)}-v${manifest.version}`,
);
if (!publicPackage) throw new Error(`Release tag ${tag} does not match a public workspace version.`);

const existing = execFileSync("gh", ["release", "list", "--limit", "100", "--json", "tagName"], { encoding: "utf8" });
if (JSON.parse(existing).some((release) => release.tagName === tag)) {
  console.log(`GitHub release ${tag} already exists.`);
} else {
  const directory = mkdtempSync(join(tmpdir(), RELEASE_ARCHIVE_PREFIX));
  try {
    const notesFile = join(directory, "notes.md");
    const notes = readReleaseNotes(
      readFileSync(join(publicPackage.directory, CHANGELOG_FILE), "utf8"),
      publicPackage.manifest.version,
    );
    writeFileSync(notesFile, notes);
    execFileSync(
      "gh",
      [
        "release",
        "create",
        tag,
        "--verify-tag",
        "--title",
        `${publicPackage.manifest.name}@${publicPackage.manifest.version}`,
        "--notes-file",
        notesFile,
      ],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
