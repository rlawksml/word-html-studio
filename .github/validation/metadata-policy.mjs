// Data-only source-map-js update. Metadata input pins are intentionally
// separate from the unchanged offline-app baseline and its test expectations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const INPUT_PACKAGE_SHA256 = "4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8";
export const INPUT_LOCK_SHA256 = "bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe";
export const TARGET_PATH = "node_modules/source-map-js";
export const TARGET_VERSION = "1.2.2";
export const TARGET_RESOLVED = "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz";
// Observed by the trusted parent from the official npm registry, not invented
// or accepted from a generated lock. The parent also reviews received bytes.
export const TARGET_INTEGRITY = "sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==";
export const METADATA_LIMITS = Object.freeze({ package: 65536, lock: 2 * 1024 * 1024 });
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const LOCK_PATH = /^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/;
const BUNDLE_PARENT = "node_modules/@tailwindcss/oxide-wasm32-wasi";
const BUNDLED_VERSIONS = Object.freeze({
  "@emnapi/core": "1.8.1", "@emnapi/runtime": "1.8.1", "@emnapi/wasi-threads": "1.1.0",
  "@napi-rs/wasm-runtime": "1.1.1", "@tybys/wasm-util": "0.10.1", tslib: "2.8.1",
});
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function parseMetadata(bytes, kind) {
  assert.ok(Object.hasOwn(METADATA_LIMITS, kind));
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= METADATA_LIMITS[kind]);
  const text = decoder.decode(bytes), value = JSON.parse(text);
  assert.ok(record(value));
  // npm's ordinary two-space JSON format; also rejects duplicate keys rather
  // than silently accepting whichever duplicate JSON.parse retained.
  assert.equal(text, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
function dependencySpecs(value, root) {
  if (value === undefined) return;
  assert.ok(record(value));
  for (const [name, spec] of Object.entries(value)) {
    assert.ok(NAME.test(name) && ![".", ".."].includes(name));
    assert.ok(typeof spec === "string" && spec.length > 0 && spec.length <= 256);
    if (root) assert.match(spec, /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    const range = spec.startsWith("npm:") ? spec.replace(/^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@/, "") : spec;
    assert.ok(!/[\/:\\@]/.test(range) && !/\b(?:file|git|workspace|link|https?)\b/i.test(range));
    assert.match(range, /^[0-9A-Za-z.*~^<>=|+ -]+$/);
  }
}
function validateGraph(manifest, lock) {
  assert.equal(manifest.private, true);
  for (const key of ["workspaces", "overrides", "bundleDependencies", "bundledDependencies"]) assert.ok(!manifest[key]);
  assert.equal(lock.lockfileVersion, 3);
  assert.ok(record(lock.packages) && Object.keys(lock.packages).length > 0 && Object.keys(lock.packages).length <= 4000);
  assert.ok(record(lock.packages[""]));
  for (const field of FIELDS) {
    dependencySpecs(manifest[field], true);
    assert.deepEqual(lock.packages[""][field], manifest[field]);
  }
  const bundle = lock.packages[BUNDLE_PARENT];
  assert.equal(bundle?.version, "4.2.1");
  assert.ok(Array.isArray(bundle.bundleDependencies));
  assert.deepEqual([...bundle.bundleDependencies].sort(), Object.keys(BUNDLED_VERSIONS).sort());
  const seen = new Set();
  for (const [path, item] of Object.entries(lock.packages)) {
    assert.ok(record(item) && !item.link);
    for (const field of FIELDS) dependencySpecs(item[field], path === "");
    if (path === "") continue;
    assert.ok(LOCK_PATH.test(path) && path.split("/").every((part) => part !== "." && part !== ".."));
    assert.ok(typeof item.version === "string" && item.version.length <= 128);
    assert.match(item.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
    if (item.inBundle === true) {
      assert.ok(path.startsWith(`${BUNDLE_PARENT}/node_modules/`));
      const name = path.slice(`${BUNDLE_PARENT}/node_modules/`.length);
      assert.ok(Object.hasOwn(BUNDLED_VERSIONS, name));
      assert.equal(item.version, BUNDLED_VERSIONS[name]);
      assert.ok(!Object.hasOwn(item, "resolved") && !Object.hasOwn(item, "integrity"));
      assert.ok(record(bundle.dependencies) && Object.hasOwn(bundle.dependencies, name) && bundle.bundleDependencies.includes(name));
      seen.add(name);
      continue;
    }
    assert.ok(typeof item.resolved === "string" && item.resolved.length <= 2048);
    const url = new URL(item.resolved);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "registry.npmjs.org");
    assert.ok(!url.username && !url.password && !url.port && !url.search && !url.hash);
    assert.equal(url.href, item.resolved);
    assert.match(url.pathname, /^\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/-\/[a-zA-Z0-9._+-]+\.tgz$/);
    assert.ok(!url.pathname.split("/").includes(".."));
    assert.ok(typeof item.integrity === "string" && item.integrity.length === 95);
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    const data = item.integrity.slice(7), decoded = Buffer.from(data, "base64");
    assert.equal(decoded.length, 64);
    assert.equal(decoded.toString("base64"), data);
  }
  assert.deepEqual([...seen].sort(), Object.keys(BUNDLED_VERSIONS).sort());
}
function originalPair(packageBytes, lockBytes) {
  const manifest = parseMetadata(packageBytes, "package"), lock = parseMetadata(lockBytes, "lock");
  validateGraph(manifest, lock);
  assert.deepEqual(Object.keys(lock.packages).filter((path) => /(?:^|\/)node_modules\/source-map-js$/.test(path)), [TARGET_PATH]);
  assert.equal(lock.packages[TARGET_PATH].version, "1.2.1");
  return { manifest, lock };
}
export function validateOriginalPair(packageBytes, lockBytes) {
  assert.equal(sha256(packageBytes), INPUT_PACKAGE_SHA256);
  assert.equal(sha256(lockBytes), INPUT_LOCK_SHA256);
  return originalPair(packageBytes, lockBytes);
}
export function validateCandidate(originalPackageBytes, originalLockBytes, packageBytes, lockBytes) {
  // Pure structural comparison also supports synthetic policy tests. Every
  // executable metadata caller first enforces validateOriginalPair's pins.
  const { lock: originalLock } = originalPair(originalPackageBytes, originalLockBytes);
  const manifest = parseMetadata(packageBytes, "package"), lock = parseMetadata(lockBytes, "lock");
  assert.ok(packageBytes.length + lockBytes.length <= METADATA_LIMITS.package + METADATA_LIMITS.lock);
  assert.ok(packageBytes.equals(originalPackageBytes));
  assert.deepEqual({ ...lock, packages: null }, { ...originalLock, packages: null });
  assert.deepEqual(Object.keys(lock.packages), Object.keys(originalLock.packages));
  validateGraph(manifest, lock);
  for (const [path, item] of Object.entries(originalLock.packages)) {
    if (path === TARGET_PATH) continue;
    assert.equal(JSON.stringify(lock.packages[path]), JSON.stringify(item));
  }
  const expected = { ...originalLock.packages[TARGET_PATH], version: TARGET_VERSION,
    resolved: TARGET_RESOLVED, integrity: TARGET_INTEGRITY };
  assert.deepEqual(Object.keys(lock.packages[TARGET_PATH]), Object.keys(expected));
  assert.deepEqual(lock.packages[TARGET_PATH], expected);
  const graph = { added: 0, removed: 0, changed: 1, unchanged: Object.keys(lock.packages).length - 1 };
  // A narrow graph change is not an audit result or runtime compatibility test.
  return Object.freeze({ packageSha256: sha256(packageBytes), lockSha256: sha256(lockBytes),
    packageBytes: packageBytes.length, lockBytes: lockBytes.length, graph: Object.freeze(graph) });
}
