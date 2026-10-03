/**
 * Exercises release tooling with real Git, Bun archives and a local npm registry.
 * @file release-tests
 */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readUnreleased, releaseUnreleased } from "beez-rp/changelog";
import { NPM_TOKEN_VARIABLE } from "beez-rp/constants";
import { ReleaseStepError } from "beez-rp/create-version";
import { readReleaseNotes } from "./notes.mjs";
import { packWorkspaceRelease } from "./pack.mjs";
import { listPublicPackages } from "./packages.mjs";
import { publishWorkspacePackage } from "./publish.mjs";

const inheritedToken = process.env[NPM_TOKEN_VARIABLE];
before(() => {
  delete process.env[NPM_TOKEN_VARIABLE];
});
after(() => {
  if (inheritedToken === undefined) delete process.env[NPM_TOKEN_VARIABLE];
  else process.env[NPM_TOKEN_VARIABLE] = inheritedToken;
});
const execute = promisify(execFile);

/**
 * Writes a JSON fixture, creating its parent directory.
 * @param {string} filename - Fixture destination.
 * @param {object} value - Serializable fixture value.
 * @returns {void}
 */
function writeJson(filename, value) {
  mkdirSync(join(filename, ".."), { recursive: true });
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Creates a committed workspace with a public dependency and private packages.
 * @param {import("node:test").TestContext} context - Test cleanup owner.
 * @param {string} [registry] - Optional local registry used by publication tests.
 * @returns {string} Fixture repository root.
 */
function createRepository(context, registry) {
  const root = mkdtempSync(join(tmpdir(), "beezping-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["packages/*", "apps/*"],
    packageManager: "bun@1.3.11",
  });
  for (const directory of ["packages/server", "packages/client", "packages/core", "apps/demo"]) {
    const component = directory.split("/").at(-1);
    const manifest = {
      name: `@release-fixture/${component}`,
      version: "0.2.0",
      type: "module",
      files: ["dist"],
      main: "./dist/index.js",
      private: component === "core" || component === "demo",
      publishConfig: { access: "public", ...(registry ? { registry } : {}) },
    };
    if (component === "client") {
      manifest.dependencies = { "@release-fixture/server": "workspace:^" };
      manifest.peerDependencies = { "@release-fixture/server": ">=0.2.0 <1.0.0" };
      manifest.devDependencies = { "@release-fixture/core": "workspace:*" };
    }
    writeJson(join(root, directory, "package.json"), manifest);
    mkdirSync(join(root, directory, "dist"));
    writeFileSync(join(root, directory, "dist/index.js"), "export const ready = true;\n");
    writeFileSync(
      join(root, directory, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Fix fixture behavior.\n",
    );
  }
  writeFileSync(join(root, ".gitignore"), ".env\nnode_modules/\n");
  writeFileSync(join(root, ".env"), "NPM_TOKEN=local-registry-fixture-token\n");
  execFileSync("bun", ["install", "--ignore-scripts"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.test",
      "commit",
      "--quiet",
      "-m",
      "feat: initial workspaces",
    ],
    { cwd: root },
  );
  return root;
}

/**
 * Provides the npm endpoints used by real beez-rp auth and npm publish.
 * @param {import("node:test").TestContext} context - Test cleanup owner.
 * @param {{ rejectAuth?: boolean, rejectPublish?: boolean, initialVersion?: string, rejectedPackage?: string | null }} [options] - Controlled external failures.
 * @returns {Promise<{ url: string, publications: object[] }>} Listening registry and captured writes.
 */
async function createRegistry(context, options = {}) {
  const publications = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/-/whoami") {
      response.statusCode = options.rejectAuth ? 401 : 200;
      response.end(
        JSON.stringify(options.rejectAuth ? { error: "Invalid fixture token" } : { username: "release-fixture" }),
      );
      return;
    }
    if (request.method === "PUT") {
      let body = "";
      for await (const chunk of request) body += chunk;
      if (
        options.rejectPublish ||
        (options.rejectedPackage && decodeURIComponent(request.url).includes(options.rejectedPackage))
      ) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "Fixture publication denied" }));
      } else {
        publications.push(JSON.parse(body));
        response.statusCode = 201;
        response.end(JSON.stringify({ ok: true }));
      }
      return;
    }
    const name = decodeURIComponent(request.url.split("?")[0].slice(1));
    const versions = options.initialVersion
      ? { [options.initialVersion]: { name, version: options.initialVersion } }
      : {};
    for (const publication of publications.filter((candidate) => candidate.name === name)) {
      Object.assign(versions, publication.versions);
    }
    const latest = Object.keys(versions).at(-1);
    response.end(
      JSON.stringify({
        name,
        maintainers: [{ name: "release-fixture", email: "release@example.test" }],
        versions,
        "dist-tags": latest ? { latest } : {},
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  return { url: `http://127.0.0.1:${server.address().port}/`, publications };
}

test("should discover public workspaces when private core and demo exist", (context) => {
  const root = createRepository(context);
  assert.deepEqual(
    listPublicPackages(root).map(({ directory }) => directory),
    ["packages/client", "packages/server"],
  );
});

test("should resolve workspace ranges in the archive while preserving tracked manifests", (context) => {
  const root = createRepository(context);
  const filename = join(root, "packages/client/package.json");
  const original = readFileSync(filename, "utf8");
  const archive = packWorkspaceRelease(root, {
    name: "@release-fixture/client",
    version: "0.2.0",
    directory: "packages/client",
  });
  context.after(() => rmSync(archive.directory, { recursive: true, force: true }));
  const packedManifest = JSON.parse(
    execFileSync("tar", ["-xOf", join(archive.directory, archive.filename), "package/package.json"], {
      encoding: "utf8",
    }),
  );
  assert.equal(packedManifest.dependencies["@release-fixture/server"], "^0.2.0");
  assert.equal(packedManifest.peerDependencies["@release-fixture/server"], ">=0.2.0 <1.0.0");
  assert.equal(readFileSync(filename, "utf8"), original);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
  assert.equal(
    execFileSync("tar", ["-xOf", join(archive.directory, archive.filename), "package/dist/index.js"], {
      encoding: "utf8",
    }),
    "export const ready = true;\n",
  );
});

test("should reject packing when release identity differs or tracked files changed", (context) => {
  const root = createRepository(context);
  const release = { name: "@release-fixture/client", version: "0.2.0", directory: "packages/client" };
  assert.throws(() => packWorkspaceRelease(root, { ...release, version: "0.3.0" }), ReleaseStepError);
  assert.throws(() => packWorkspaceRelease(root, { ...release, directory: "../outside" }), ReleaseStepError);
  writeFileSync(join(root, "packages/client/dist/index.js"), "export const ready = false;\n");
  assert.throws(() => packWorkspaceRelease(root, release), /Tracked files changed/);
});

test("should publish an installable archive through real npm and original-checkout credentials", async (context) => {
  const registry = await createRegistry(context);
  const credentialsRoot = createRepository(context, registry.url);
  const checkoutRoot = createRepository(context, registry.url);
  rmSync(join(checkoutRoot, ".env"));
  const release = { name: "@release-fixture/client", version: "0.2.0", directory: "packages/client" };
  await publishWorkspacePackage({ repositoryRoot: checkoutRoot, releases: [release] }, credentialsRoot);
  assert.equal(registry.publications.length, 1);
  const packed = registry.publications[0].versions["0.2.0"];
  assert.equal(packed.name, release.name);
  assert.equal(packed.dependencies["@release-fixture/server"], "^0.2.0");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: checkoutRoot, encoding: "utf8" }), "");
});

test("should reject invalid credentials before uploading an archive", async (context) => {
  const registry = await createRegistry(context, { rejectAuth: true });
  const root = createRepository(context, registry.url);
  await assert.rejects(
    publishWorkspacePackage({
      repositoryRoot: root,
      releases: [{ name: "@release-fixture/client", version: "0.2.0", directory: "packages/client" }],
    }),
    ReleaseStepError,
  );
  assert.equal(registry.publications.length, 0);
});

test("should surface rejected npm publication without reporting success", async (context) => {
  const registry = await createRegistry(context, { rejectPublish: true });
  const root = createRepository(context, registry.url);
  // Capture the expected npm rejection without hiding failures in real releases.
  await assert.rejects(
    execute(process.execPath, [
      "--input-type=module",
      "--eval",
      `import { publishWorkspacePackage } from ${JSON.stringify(new URL("./publish.mjs", import.meta.url).href)};
await publishWorkspacePackage(${JSON.stringify({
        repositoryRoot: root,
        releases: [{ name: "@release-fixture/client", version: "0.2.0", directory: "packages/client" }],
      })});`,
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Fixture publication denied/);
      assert.match(error.stderr, /npm publish failed/);
      return true;
    },
  );
  assert.equal(registry.publications.length, 0);
});

test("should reject a missing release before accessing npm", async () => {
  await assert.rejects(publishWorkspacePackage({ repositoryRoot: "unused", releases: [] }), ReleaseStepError);
});

test("should release new Keep a Changelog notes while retaining historical notes", () => {
  const history =
    "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Fix annotations.\n\n## [0.2.0](https://example.test/tag) (2026-10-01)\n\n### Features\n\n* Initial implementation.\n";
  const released = releaseUnreleased(history, "0.2.1", "2026-10-02");
  assert.equal(readUnreleased(released).entryCount, 0);
  assert.equal(readReleaseNotes(released, "0.2.1"), "### Fixed\n\n- Fix annotations.");
  assert.equal(readReleaseNotes(released, "0.2.0"), "### Features\n\n* Initial implementation.");
  assert.throws(() => readReleaseNotes(released, "0.2.2"), /No changelog notes/);
});

test("should plan without writes and resume only missing packages after a partial release", async (context) => {
  const options = { initialVersion: "0.2.0", rejectedPackage: "/client" };
  const registry = await createRegistry(context, options);
  const root = createRepository(context, registry.url);
  const remote = mkdtempSync(join(tmpdir(), "beezping-remote-"));
  context.after(() => rmSync(remote, { recursive: true, force: true }));
  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
  const publisherUrl = new URL("./publish.mjs", import.meta.url).href;
  writeFileSync(
    join(root, "beez-rp.config.js"),
    `import { publishWorkspacePackage } from ${JSON.stringify(publisherUrl)};\nexport default { packages: "workspaces", changelog: { audience: "fixture developers", language: "en" }, checks: false, prepare: ["bun install --frozen-lockfile --ignore-scripts"], registry: "npm", publish: publishWorkspacePackage };\n`,
  );
  for (const component of ["client", "server"]) {
    writeFileSync(join(root, `packages/${component}/dist/index.js`), "export const ready = false;\n");
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.test",
      "commit",
      "--quiet",
      "-m",
      "fix: update public workspaces",
    ],
    { cwd: root },
  );
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "release@example.test"], { cwd: root });
  execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: root });
  const cli = fileURLToPath(new URL("bin/beez-rp.js", import.meta.resolve("beez-rp/package.json")));
  const beforeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const env = { ...process.env, NPM_TOKEN: "local-registry-fixture-token", NPM_CONFIG_PROVENANCE: "false" };
  const plan = await execute(process.execPath, [cli, "create-version", "--bump", "patch", "--dry-run"], {
    cwd: root,
    env,
  });
  assert.match(plan.stdout, /Crear el commit de release/);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }), beforeHead);
  assert.equal(registry.publications.length, 0);
  await assert.rejects(
    execute(process.execPath, [cli, "create-version", "--bump", "patch"], { cwd: root, env }),
    (error) => error.code === 1,
  );
  assert.deepEqual(
    registry.publications.map((publication) => publication.name),
    ["@release-fixture/server"],
  );
  assert.equal(JSON.parse(readFileSync(join(root, "packages/server/package.json"), "utf8")).version, "0.2.1");
  options.rejectedPackage = null;
  await execute(process.execPath, [cli, "create-version", "--bump", "patch"], { cwd: root, env });
  assert.deepEqual(
    registry.publications.map((publication) => publication.name),
    ["@release-fixture/server", "@release-fixture/client"],
  );
  assert.equal(registry.publications[1].versions["0.2.1"].dependencies["@release-fixture/server"], "^0.2.1");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
  const verifier = fileURLToPath(new URL("../verify-npm-publish.mjs", import.meta.url));
  const verified = await execute(process.execPath, [verifier], {
    cwd: root,
    env: { ...env, VERIFY_PUBLISH_ATTEMPTS: "1" },
  });
  assert.match(verified.stdout, /All 2 workspace versions are live on npm/);
});
