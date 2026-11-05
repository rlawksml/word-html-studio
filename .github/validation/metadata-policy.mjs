// Data-only contract for exactly five fixed toolchain version changes. This
// does not approve transitive changes or weaken the offline app validator.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const TOOLCHAIN_UPDATES = Object.freeze({
  vinext: Object.freeze(["0.0.50", "1.2.0"]),
  "@vitejs/plugin-rsc": Object.freeze(["0.5.26", "0.5.37"]),
  "@cloudflare/vite-plugin": Object.freeze(["1.54.5", "1.63.1"]),
  wrangler: Object.freeze(["4.129.1", "4.149.0"]),
  "@cloudflare/workers-types": Object.freeze(["5.20260921.1", "5.20261006.1"]),
});
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
export function toolchainManifest(original) {
  assert.ok(record(original) && record(original.dependencies) && record(original.devDependencies));
  const candidate = structuredClone(original);
  for (const [name, [from, to]] of Object.entries(TOOLCHAIN_UPDATES)) {
    assert.equal(original.devDependencies[name], from);
    candidate.devDependencies[name] = to;
  }
  return candidate;
}
export function validateCandidate(originalPackageBytes, originalLockBytes, packageBytes, lockBytes) {
  const original = parseMetadata(originalPackageBytes, "package"), originalLock = parseMetadata(originalLockBytes, "lock");
  const manifest = parseMetadata(packageBytes, "package"), lock = parseMetadata(lockBytes, "lock");
  assert.ok(packageBytes.length + lockBytes.length <= METADATA_LIMITS.package + METADATA_LIMITS.lock);
  assert.deepEqual(manifest, toolchainManifest(original));
  assert.deepEqual({ ...lock, packages: null }, { ...originalLock, packages: null });
  const root = structuredClone(originalLock.packages[""]);
  for (const [name, [, to]] of Object.entries(TOOLCHAIN_UPDATES)) root.devDependencies[name] = to;
  assert.deepEqual(lock.packages[""], root);
  validateGraph(manifest, lock);
  for (const [name, [, to]] of Object.entries(TOOLCHAIN_UPDATES)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, to);
  }
  const keys = new Set([...Object.keys(originalLock.packages), ...Object.keys(lock.packages)]);
  const graph = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const key of keys) {
    if (!Object.hasOwn(originalLock.packages, key)) graph.added++;
    else if (!Object.hasOwn(lock.packages, key)) graph.removed++;
    else if (JSON.stringify(originalLock.packages[key]) !== JSON.stringify(lock.packages[key])) graph.changed++;
    else graph.unchanged++;
  }
  // These counters identify review work. They are NOT automatic approval of
  // every transitive change, an audit result, or proof that sharp is patched.
  return Object.freeze({ packageSha256: sha256(packageBytes), lockSha256: sha256(lockBytes),
    packageBytes: packageBytes.length, lockBytes: lockBytes.length, graph: Object.freeze(graph) });
}
