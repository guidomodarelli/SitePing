/**
 * Runs a validation command with compact success output and complete failure diagnostics.
 * @file run-check
 */
import { spawnSync } from "node:child_process";
import { closeSync, createReadStream, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { VERBOSE_CHECK_VARIABLE } from "./constants/check-output.mjs";

const [label, command, ...args] = process.argv.slice(2);

if (!label || !command) {
  console.error("Usage: node scripts/run-check.mjs <label> <command> [arguments...]");
  process.exit(1);
}

const verbose = process.env[VERBOSE_CHECK_VARIABLE] === "1";
const directory = verbose ? undefined : mkdtempSync(join(tmpdir(), "beezping-check-"));
const logPath = directory ? join(directory, "output.log") : undefined;
let descriptor;

try {
  if (logPath) descriptor = openSync(logPath, "w+");
  console.log(`${label}: running…`);
  const result = spawnSync(command, args, {
    stdio: verbose ? "inherit" : ["inherit", descriptor, descriptor],
  });

  if (result.status === 0 && !result.error) {
    console.log(`${label}: OK`);
  } else {
    console.error(`${label}: FAILED${result.signal ? ` (${result.signal})` : ""}`);
    if (logPath) await pipeline(createReadStream(logPath), process.stderr, { end: false });
    if (result.error) console.error(`${label}: could not execute ${command}: ${result.error.message}`);
    process.exitCode = result.status ?? 1;
  }
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  if (directory) rmSync(directory, { recursive: true, force: true });
}
