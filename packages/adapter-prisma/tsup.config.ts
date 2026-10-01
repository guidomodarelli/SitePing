import { defineConfig } from "tsup";
import { sitepingLibrary } from "../../tsup.preset.js";

export default defineConfig(
  sitepingLibrary({
    platform: "node",
    target: "node18",
    external: ["@prisma/client"],
    // Bundle server declarations too, so TypeScript consumers need no second install.
    dts: { resolve: ["@beezping/server"] },
    // The handler lives in @beezping/server; bundle it like core so the
    // published adapter keeps a single-install footprint (zod stays external).
    noExternal: [/^@beezping\/core(\/|$)/, /^@beezping\/server(\/|$)/],
  }),
);
