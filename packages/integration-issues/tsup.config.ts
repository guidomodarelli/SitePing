import { defineConfig } from "tsup";
import { beezpingLibrary } from "../../tsup.preset.js";

// One entry per provider so importing ./github never pulls the others.
// @beezping/server is a peer: only its types are imported.
export default defineConfig(
  beezpingLibrary({
    platform: "neutral",
    entry: {
      index: "src/index.ts",
      github: "src/providers/github.ts",
      gitlab: "src/providers/gitlab.ts",
    },
    external: [/^@beezping\/server(\/|$)/],
  }),
);
