import { defineConfig } from "tsup";
import { sitepingLibrary } from "../../tsup.preset.js";

// One entry per provider so importing ./github never pulls the others.
// @beezping/server is a peer: only its types are imported.
// `splitting` is forced on for CJS too (tsup defaults it to ESM only): the
// shared core (IssueTrackerRequestError above all) must live in one chunk, or
// errors thrown by require("./github") fail `instanceof` against the root's class.
export default defineConfig(
  sitepingLibrary({
    platform: "neutral",
    splitting: true,
    entry: {
      index: "src/index.ts",
      github: "src/github/index.ts",
      gitlab: "src/gitlab/index.ts",
    },
    external: [/^@beezping\/server(\/|$)/],
  }),
);
