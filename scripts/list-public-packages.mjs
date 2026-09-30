#!/usr/bin/env node
// Prints the repo-relative directory of every published package, one per
// line (see public-packages.mjs). CI loops (pkg-pr-new) consume this instead
// of hand-maintained lists.

import { listPublicPackages } from "./public-packages.mjs";

for (const { path } of listPublicPackages()) {
  console.log(path);
}
