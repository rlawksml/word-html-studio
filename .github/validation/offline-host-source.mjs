// Source/data validation only; never import, require, transpile or execute app code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOCK_SHA256, PACKAGE_SHA256, TESTS } from "./offline-baseline.mjs";
import { bounded, readRegular, requireSuccess, sha256 } from "./offline-host-support.mjs";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const LOCK_PATH = /^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/;
// These six entries are data INSIDE the already integrity-pinned oxide tarball,
// not separately fetched packages. No general exemption for bundled records.
const BUNDLE_PARENT = "node_modules/@tailwindcss/oxide-wasm32-wasi";
const BUNDLED_VERSIONS = Object.freeze({
  "@emnapi/core": "1.8.1", "@emnapi/runtime": "1.8.1", "@emnapi/wasi-threads": "1.1.0",
  "@napi-rs/wasm-runtime": "1.1.1", "@tybys/wasm-util": "0.10.1", tslib: "2.8.1",
});
function dependencySpecs(value, root) {
  if (value === undefined) return;
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  for (const [name, spec] of Object.entries(value)) {
    assert.ok(NAME.test(name) && ![".", ".."].includes(name));
    assert.ok(typeof spec === "string" && spec.length > 0 && spec.length <= 256);
    if (root) assert.match(spec, /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    // Transitive npm aliases are permitted only as package + semver data; all
    // their actual locked tarballs still require the official URL + integrity.
    const range = spec.startsWith("npm:") ? spec.replace(/^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@/, "") : spec;
    assert.ok(!/[\/:\\@]/.test(range) && !/\b(?:file|git|workspace|link|https?)\b/i.test(range));
    assert.match(range, /^[0-9A-Za-z.*~^<>=|+ -]+$/);
  }
}
export function validateManifests(packageBytes, lockBytes) {
  assert.equal(sha256(packageBytes), PACKAGE_SHA256);
  assert.equal(sha256(lockBytes), LOCK_SHA256);
  const manifest = JSON.parse(packageBytes.toString("utf8"));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  assert.equal(manifest.private, true);
  assert.ok(!manifest.workspaces && !manifest.overrides && !manifest.bundleDependencies && !manifest.bundledDependencies);
  assert.equal(lock.lockfileVersion, 3);
  assert.ok(lock.packages && typeof lock.packages === "object" && !Array.isArray(lock.packages));
  assert.ok(Object.keys(lock.packages).length <= 4000);
  const bundle = lock.packages[BUNDLE_PARENT];
  assert.equal(bundle?.version, "4.2.1");
  assert.deepEqual([...bundle.bundleDependencies].sort(), Object.keys(BUNDLED_VERSIONS).sort());
  const seenBundled = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    dependencySpecs(manifest[field], true);
    assert.deepEqual(lock.packages[""][field], manifest[field]);
  }
  assert.equal(manifest.scripts.test, `npm run build && node --test ${TESTS.join(" ")}`);
  for (const [path, item] of Object.entries(lock.packages)) {
    assert.ok(item && typeof item === "object" && !Array.isArray(item) && !item.link);
    for (const field of DEPENDENCY_FIELDS) dependencySpecs(item[field], path === "");
    if (path === "") continue;
    assert.ok(LOCK_PATH.test(path) && path.split("/").every((part) => ![".", ".."].includes(part)));
    if (item.inBundle === true) {
      assert.ok(path.startsWith(`${BUNDLE_PARENT}/node_modules/`));
      const name = path.slice(`${BUNDLE_PARENT}/node_modules/`.length);
      assert.ok(Object.hasOwn(BUNDLED_VERSIONS, name));
      assert.equal(item.version, BUNDLED_VERSIONS[name]);
      assert.ok(!Object.hasOwn(item, "resolved") && !Object.hasOwn(item, "integrity"));
      assert.ok(Object.hasOwn(bundle.dependencies, name) && bundle.bundleDependencies.includes(name));
      seenBundled.add(name);
      continue;
    }
    assert.equal(typeof item.resolved, "string");
    const url = new URL(item.resolved);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "registry.npmjs.org");
    assert.ok(!url.username && !url.password && !url.port && !url.search && !url.hash);
    assert.equal(url.href, item.resolved);
    assert.match(url.pathname, /^\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/-\/[a-zA-Z0-9._+-]+\.tgz$/);
    assert.ok(!url.pathname.split("/").includes(".."));
    assert.equal(typeof item.integrity, "string");
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    const integrity = item.integrity.slice(7);
    assert.equal(Buffer.from(integrity, "base64").length, 64);
    assert.equal(Buffer.from(integrity, "base64").toString("base64"), integrity);
  }
  assert.deepEqual([...seenBundled].sort(), Object.keys(BUNDLED_VERSIONS).sort());
  return { packageBytes, lockBytes };
}
const FORBIDDEN = new Set([
  ".git", "node_modules", ".next", ".wrangler", ".cache", ".npm", "dist",
  "data", "backups", "exports", "storage", "uploads", ".openai",
  "home", "env", "envs", ".ssh", ".aws", ".docker", ".config",
]);
function includeSource(path) {
  const parts = path.split("/");
  assert.ok(path && !path.startsWith("/") && !/[\x00-\x1f\x7f\\]/.test(path));
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."));
  return !parts.some((part) => FORBIDDEN.has(part.toLowerCase())
    || /^\.env/i.test(part) || /\.env$/i.test(part) || /^\.dev\.vars/i.test(part)
    || /^(?:\.?npmrc|npm-shrinkwrap\.json)$/i.test(part));
}
export async function copyReviewedSources(workspace, commit, rootfs) {
  const git = (args) => bounded("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: workspace, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  assert.equal(requireSuccess(await git(["rev-parse", "HEAD"]), "SOURCE_HEAD_UNCONFIRMED").trim(), commit);
  const tree = requireSuccess(await git(["ls-tree", "-rz", "--full-tree", commit]), "SOURCE_TREE_UNCONFIRMED");
  const entries = tree.split("\0").filter(Boolean);
  assert.ok(entries.length > 0 && entries.length <= 2000);
  const digest = createHash("sha256");
  let bytesTotal = 0, files = 0;
  const sourcePaths = [];
  let packageBytes, lockBytes;
  for (const record of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
    // Symlinks/submodules/unknown modes are rejected, not dereferenced.
    assert.ok(match);
    const [, , oid, path] = match;
    if (!includeSource(path)) continue;
    const bytes = readRegular(join(workspace, path), 16 * 1024 * 1024);
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(blob, oid); // dirty/untracked bytes cannot enter the source image
    bytesTotal += bytes.length;
    assert.ok(bytesTotal <= 64 * 1024 * 1024);
    const destination = join(rootfs, "source", path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    writeFileSync(destination, bytes, { flag: "wx", mode: 0o444 });
    chmodSync(destination, 0o444);
    digest.update(path).update("\0").update(sha256(bytes)).update("\0");
    files++;
    sourcePaths.push(path);
    if (path === "apps/web/package.json") packageBytes = bytes;
    if (path === "apps/web/package-lock.json") lockBytes = bytes;
  }
  assert.ok(packageBytes && packageBytes.length <= 65536 && lockBytes && lockBytes.length <= 2 * 1024 * 1024);
  validateManifests(packageBytes, lockBytes);
  return { files, bytes: bytesTotal, digest: digest.digest("hex"), packageBytes, lockBytes, sourcePaths: Object.freeze(sourcePaths) };
}
