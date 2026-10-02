/**
 * Checks credentials before beez-rp creates release commits or pushes tags.
 * @file release-preflight
 */
import { assertPublicationAccess } from "./auth.mjs";
import { listPublicPackages } from "./packages.mjs";

for (const { manifest } of listPublicPackages(process.cwd())) {
  await assertPublicationAccess(process.cwd(), manifest);
  console.log(`npm access confirmed: ${manifest.name}`);
}
