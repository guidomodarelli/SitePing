/**
 * Exercises the validation runner through real child processes and terminal streams.
 * @file run-check-tests
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./run-check.mjs", import.meta.url));

/**
 * Executes the runner with a real Node command and inherited test environment.
 * @param {string} script - Child behavior to exercise.
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} [options] - Terminal input and environment.
 * @param {string[]} [args] - Extra child arguments.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Exit status and terminal output.
 */
function runCheck(script, options = {}, args = []) {
  return spawnSync(process.execPath, [runner, "fixture", process.execPath, "--eval", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, BEEZPING_VERBOSE: "0" },
    ...options,
  });
}

test("should hide successful stdout and stderr while reporting completion", () => {
  const result = runCheck('console.log("child output"); console.error("child warning");');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /fixture: running/);
  assert.match(result.stdout, /fixture: OK/);
  assert.doesNotMatch(result.stdout + result.stderr, /child output|child warning/);
});

test("should replay both diagnostic streams and preserve a failing exit code", () => {
  const result = runCheck('console.log("child context"); console.error("child failure"); process.exitCode = 7;');
  assert.equal(result.status, 7);
  assert.match(result.stderr, /fixture: FAILED/);
  assert.match(result.stderr, /child context/);
  assert.match(result.stderr, /child failure/);
  assert.doesNotMatch(result.stdout, /fixture: OK/);
});

test("should forward arguments, environment, working directory and stdin", () => {
  const workingDirectory = realpathSync(tmpdir());
  const result = runCheck(
    `const assert = require("node:assert/strict");
assert.equal(process.argv[1], "argument with spaces");
assert.equal(process.env.CHECK_FIXTURE_VALUE, "inherited");
assert.equal(process.cwd(), process.env.CHECK_FIXTURE_CWD);
assert.equal(require("node:fs").readFileSync(0, "utf8"), "terminal input");`,
    {
      input: "terminal input",
      cwd: workingDirectory,
      env: {
        ...process.env,
        BEEZPING_VERBOSE: "0",
        CHECK_FIXTURE_VALUE: "inherited",
        CHECK_FIXTURE_CWD: workingDirectory,
      },
    },
    ["argument with spaces"],
  );
  assert.equal(result.status, 0, result.stderr);
});

test("should keep successful diagnostics visible when verbose output is requested", () => {
  const result = runCheck('console.log("child output"); console.error("child warning");', {
    env: { ...process.env, BEEZPING_VERBOSE: "1" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /child output/);
  assert.match(result.stderr, /child warning/);
});

test("should replay large diagnostics completely without a capture buffer limit", () => {
  const result = runCheck(
    'require("node:fs").writeSync(2, Array.from({ length: 32 }, (_, index) => String(index).padStart(2, "0").repeat(32768)).join("")); process.exitCode = 2;',
    { maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(result.status, 2);
  assert.ok(
    result.stderr.endsWith(
      Array.from({ length: 32 }, (_, index) => String(index).padStart(2, "0").repeat(32768)).join(""),
    ),
  );
});

test("should report an unavailable command as a failure", () => {
  const result = spawnSync(process.execPath, [runner, "fixture", "beezping-missing-fixture-command"], {
    encoding: "utf8",
    env: { ...process.env, BEEZPING_VERBOSE: "0" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not execute beezping-missing-fixture-command/);
});

test("should reject missing command arguments with actionable usage", () => {
  const result = spawnSync(process.execPath, [runner], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
