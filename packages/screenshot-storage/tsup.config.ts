import { defineConfig } from "tsup";
import { sitepingLibrary } from "../../tsup.preset.js";

// One entry per backend so importing ./s3 never pulls node:fs and vice versa.
// Only ./filesystem uses Node built-ins; they stay external.
export default defineConfig(
  sitepingLibrary({
    platform: "neutral",
    entry: {
      index: "src/index.ts",
      memory: "src/memory/index.ts",
      filesystem: "src/filesystem/index.ts",
      "cloudflare-images": "src/cloudflare-images/index.ts",
      s3: "src/s3/index.ts",
    },
    external: [/^node:/],
  }),
);
