import { defineConfig } from "tsup";
import { beezpingLibrary } from "../../tsup.preset.js";

export default defineConfig(beezpingLibrary({ platform: "neutral" }));
