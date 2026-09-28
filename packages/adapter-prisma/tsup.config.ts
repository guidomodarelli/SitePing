import { defineConfig } from "tsup";
import { sitepingLibrary } from "../../tsup.preset.js";

export default defineConfig(
  sitepingLibrary({
    platform: "node",
    target: "node18",
    external: ["@prisma/client"],
    // The handler lives in @siteping/server; bundle it like core so the
    // published adapter keeps a single-install footprint (zod stays external).
    noExternal: [/^@siteping\/core(\/|$)/, /^@siteping\/server(\/|$)/],
  }),
);
