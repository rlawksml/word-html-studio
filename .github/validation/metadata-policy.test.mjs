// Native-only synthetic policy tests. No npm, registry, Docker, env file or DB.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { INPUT_LOCK_SHA256, INPUT_PACKAGE_SHA256, TARGET_INTEGRITY, TARGET_PATH, TARGET_RESOLVED,
  parseMetadata, sha256, validateCandidate, validateOriginalPair } from "./metadata-policy.mjs";
import { decodePacket, encodePacket, EXPORT_PACKET_LIMIT, kindForAction } from "./metadata-packet.mjs";
import { readStableFile } from "./metadata-file-io.mjs";
import { requireTransferApproval } from "./metadata-approval.mjs";
import { promotePair, verifyRetained } from "./metadata-retained-check.mjs";

const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const NONCE = "a".repeat(32), COMMIT = "b".repeat(40);
function synthetic() {
  const manifest = { name: "synthetic-metadata-only", version: "1.1.0-rc.1", private: true,
    engines: { node: ">=22.13.0" }, scripts: { test: "never evaluated" },
    dependencies: { next: "16.4.5", react: "19.2.8" }, devDependencies: { "eslint-config-next": "16.4.5" } };
  const pkg = (name, version) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
    integrity: `sha512-${Buffer.alloc(64).toString("base64")}` });
  const bundled = { "@emnapi/core": "1.8.1", "@emnapi/runtime": "1.8.1", "@emnapi/wasi-threads": "1.1.0",
    "@napi-rs/wasm-runtime": "1.1.1", "@tybys/wasm-util": "0.10.1", tslib: "2.8.1" };
  const parent = "node_modules/@tailwindcss/oxide-wasm32-wasi";
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { "": { name: manifest.name, version: manifest.version, dependencies: { ...manifest.dependencies },
      devDependencies: { ...manifest.devDependencies }, engines: { ...manifest.engines } },
    "node_modules/next": pkg("next", "16.4.5"), "node_modules/react": pkg("react", "19.2.8"),
    "node_modules/eslint-config-next": pkg("eslint-config-next", "16.4.5"),
    [TARGET_PATH]: { ...pkg("source-map-js", "1.2.1"), license: "BSD-3-Clause", engines: { node: ">=0.10.0" } },
    [parent]: { ...pkg("@tailwindcss/oxide-wasm32-wasi", "4.2.1"), dependencies: bundled, bundleDependencies: Object.keys(bundled) } } };
  for (const [name, version] of Object.entries(bundled)) lock.packages[`${parent}/node_modules/${name}`] = { version, inBundle: true };
  const candidatePackage = structuredClone(manifest), candidateLock = structuredClone(lock);
  Object.assign(candidateLock.packages[TARGET_PATH], { version: "1.2.2", resolved: TARGET_RESOLVED, integrity: TARGET_INTEGRITY });
  return { manifest, lock, candidatePackage, candidateLock };
}
function validate(value) { return validateCandidate(bytes(value.manifest), bytes(value.lock), bytes(value.candidatePackage), bytes(value.candidateLock)); }
function packetMutation(change) {
  const packet = JSON.parse(encodePacket(bytes({ synthetic: true }), "package", NONCE));
  change(packet);
  return Buffer.from(`${JSON.stringify(packet)}\n`);
}
function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), "bookstore-metadata-policy-owned-"));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const evidence = () => ({ cleaned: true, commit: COMMIT, nonce: NONCE });

test("META-01 package stays byte-identical while only source-map-js is updated", () => {
  const value = synthetic(), before = JSON.stringify(value);
  validate(value);
  assert.deepEqual(bytes(value.candidatePackage), bytes(value.manifest));
  assert.equal(value.candidateLock.packages[TARGET_PATH].version, "1.2.2");
  assert.equal(JSON.stringify(value), before);
});
test("META-02 a complete synthetic graph is accepted as shape, not actual registry trust", () => {
  const value = synthetic(), before = JSON.stringify(value);
  const summary = validate(value);
  assert.equal(summary.packageSha256, sha256(bytes(value.candidatePackage)));
  assert.equal(summary.lockSha256, sha256(bytes(value.candidateLock)));
  assert.deepEqual(summary.graph, { added: 0, removed: 0, changed: 1, unchanged: Object.keys(value.lock.packages).length - 1 });
  assert.equal(JSON.stringify(value), before);
});
test("META-03 scripts changes cannot be smuggled into a version update", () => {
  const value = synthetic(); value.candidatePackage.scripts.test = "different";
  assert.throws(() => validate(value));
});
test("META-04 other direct dependencies remain fixed", () => {
  const value = synthetic(); value.candidatePackage.dependencies.react = "19.3.1";
  assert.throws(() => validate(value));
});
test("META-05 private engines peer optional and overrides cannot change", () => {
  for (const patch of [{ private: false }, { engines: { node: "*" } }, { workspaces: [] }, { overrides: {} },
    { peerDependencies: { react: "^19.0.0" } }, { optionalDependencies: { sharp: "0.35.5" } }]) {
    const value = synthetic(); Object.assign(value.candidatePackage, patch); assert.throws(() => validate(value));
  }
});
test("META-06 all lock root metadata and direct declarations stay fixed", () => {
  for (const mutate of [(root) => { root.engines.node = "*"; },
    (root) => { root.dependencies.next = "16.4.6"; },
    (root) => { root.devDependencies["eslint-config-next"] = "16.4.6"; }]) {
    const value = synthetic(); mutate(value.candidateLock.packages[""]); assert.throws(() => validate(value));
  }
});
test("META-07 lock format and top-level metadata cannot change", () => {
  for (const patch of [{ lockfileVersion: 2 }, { version: "2.0.0" }, { newKey: true }]) {
    const value = synthetic(); Object.assign(value.candidateLock, patch); assert.throws(() => validate(value));
  }
});
test("META-08 links unsafe paths and nonregistry dependency specs fail closed", () => {
  for (const mutate of [
    (lock) => { lock.packages["node_modules/react"].link = true; },
    (lock) => { lock.packages["../escape"] = lock.packages["node_modules/react"]; },
    (lock) => { lock.packages["node_modules/react"].dependencies = { bad: "file:../bad" }; },
  ]) { const value = synthetic(); mutate(value.candidateLock); assert.throws(() => validate(value)); }
});
test("META-09 registry URL authentication alternate host and URL suffixes are rejected", () => {
  for (const url of ["http://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz", "https://example.invalid/source-map-js.tgz",
    "https://user:password@registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz", `${TARGET_RESOLVED}?secret=never`,
    `${TARGET_RESOLVED}#extra`]) {
    const value = synthetic(); value.candidateLock.packages[TARGET_PATH].resolved = url; assert.throws(() => validate(value));
  }
});
test("META-10 integrity must be exact canonical SHA512 base64", () => {
  for (const integrity of ["sha256-bad", "sha512-A===", "sha512-" + "A".repeat(88), null]) {
    const value = synthetic(); value.candidateLock.packages[TARGET_PATH].integrity = integrity; assert.throws(() => validate(value));
  }
});
test("META-11 only the precise six already-pinned bundled records are exempt", () => {
  const value = synthetic(), key = "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/tslib";
  value.candidateLock.packages[key].version = "2.8.2"; assert.throws(() => validate(value));
});
test("META-12 package and lock limits and fatal UTF8 are enforced", () => {
  assert.throws(() => parseMetadata(Buffer.alloc(65537), "package"));
  assert.throws(() => parseMetadata(Buffer.alloc(2 * 1024 * 1024 + 1), "lock"));
  assert.throws(() => parseMetadata(Buffer.from([0xff]), "lock"));
  assert.throws(() => parseMetadata(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes({})]), "package"));
  assert.throws(() => parseMetadata(bytes([]), "package"));
});
test("META-13 fixed packet roundtrip preserves exact bytes", () => {
  for (const kind of ["package", "lock"]) {
    const source = bytes({ synthetic: "📚" });
    assert.deepEqual(decodePacket(Buffer.from(encodePacket(source, kind, NONCE)), kind, NONCE), source);
  }
  assert.equal(kindForAction("export-package"), "package");
  assert.throws(() => kindForAction("export-/etc/passwd"));
});
test("META-14 packet nonce kind missing fields and extra fields are rejected", () => {
  for (const mutate of [(p) => { p.nonce = "c".repeat(32); }, (p) => { p.kind = "lock"; },
    (p) => { delete p.kind; }, (p) => { p.path = "/arbitrary"; }]) {
    assert.throws(() => decodePacket(packetMutation(mutate), "package", NONCE));
  }
});
test("META-15 duplicate keys trailing JSON reordered fields and noncanonical lines fail", () => {
  const canonical = encodePacket(bytes({}), "package", NONCE);
  for (const text of [canonical.replace('{"protocol":', '{"kind":"package","protocol":'),
    canonical + "{}", canonical.trim(), " " + canonical,
    `${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(canonical)).reverse()))}\n`]) {
    assert.throws(() => decodePacket(Buffer.from(text), "package", NONCE));
  }
  assert.throws(() => decodePacket(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)]), "package", NONCE));
  assert.throws(() => decodePacket(Buffer.from([0xff]), "package", NONCE));
});
test("META-16 base64 must roundtrip exactly and payload must be valid UTF8", () => {
  assert.throws(() => decodePacket(packetMutation((p) => { p.base64 += "="; }), "package", NONCE));
  assert.throws(() => decodePacket(Buffer.from(encodePacket(Buffer.from([0xff]), "package", NONCE)), "package", NONCE));
  const badPaddingBits = JSON.parse(encodePacket(Buffer.from("a"), "package", NONCE));
  badPaddingBits.base64 = "YR=="; // decodes to a, but canonical form is YQ==
  assert.throws(() => decodePacket(Buffer.from(`${JSON.stringify(badPaddingBits)}\n`), "package", NONCE));
});
test("META-17 packet byte hash and total output caps are independent", () => {
  for (const mutate of [(p) => { p.bytes++; }, (p) => { p.sha256 = "0".repeat(64); }]) {
    assert.throws(() => decodePacket(packetMutation(mutate), "package", NONCE));
  }
  assert.throws(() => decodePacket(Buffer.alloc(EXPORT_PACKET_LIMIT + 1), "lock", NONCE));
});
test("META-18 descriptor reader rejects symlinks hard links empty and oversized files", () => withScratch((root) => {
  const file = join(root, "synthetic.json"), link = join(root, "link.json");
  writeFileSync(file, "{}\n"); assert.deepEqual(readStableFile(file, 3), Buffer.from("{}\n"));
  symlinkSync(file, link); assert.throws(() => readStableFile(link, 3));
  linkSync(file, join(root, "hard.json")); assert.throws(() => readStableFile(file, 3));
  const empty = join(root, "empty"); writeFileSync(empty, ""); assert.throws(() => readStableFile(empty, 3));
  const large = join(root, "large"); writeFileSync(large, "1234"); assert.throws(() => readStableFile(large, 3));
}));
test("META-19 recent operator approval is necessary but not a billing guarantee", () => {
  const now = Date.parse("2026-11-05T01:00:00.000Z");
  requireTransferApproval("true", "2026-11-05T00:00:00.000Z", now);
  requireTransferApproval("true", "2026-11-05T01:00:00.000Z", now);
});
test("META-20 expired future false and invalid approval timestamps fail", () => {
  const now = Date.parse("2026-11-05T01:00:00.000Z");
  for (const [flag, time] of [["false", "2026-11-05T01:00:00.000Z"], ["true", "2026-11-04T23:59:59.999Z"],
    ["true", "2026-11-05T01:00:00.001Z"], ["true", "2026-02-30T01:00:00.000Z"]]) {
    assert.throws(() => requireTransferApproval(flag, time, now));
  }
});
test("META-21 promotion exposes exactly two files only after cleanup evidence", () => withScratch((root) => {
  const pkg = bytes({ private: true }), lock = bytes({ lockfileVersion: 3 });
  assert.throws(() => promotePair(root, pkg, lock, { ...evidence(), cleaned: false }));
  promotePair(root, pkg, lock, evidence());
  assert.deepEqual(readdirSync(join(root, "exported")).sort(), ["package-lock.json", "package.json"]);
  assert.equal(verifyRetained(root).package.sha256, sha256(pkg));
}));
test("META-22 failure on second write cannot publish a completion marker", () => withScratch((root) => {
  let calls = 0;
  assert.throws(() => promotePair(root, bytes({}), bytes({}), evidence(), (path, payload) => {
    if (++calls === 2) throw new Error("SYNTHETIC_SECOND_WRITE_FAILURE");
    writeFileSync(path, payload, { flag: "wx", mode: 0o600 });
  }));
  assert.equal(existsSync(join(root, "completion.json")), false);
  assert.throws(() => verifyRetained(root));
}));
test("META-23 retained byte tampering cannot pass pre-upload checks", () => withScratch((root) => {
  promotePair(root, bytes({}), bytes({}), evidence());
  writeFileSync(join(root, "exported", "package.json"), "{\"changed\":true}\n");
  assert.throws(() => verifyRetained(root));
}));
test("META-24 extra retained files cannot enter the two-file artifact", () => withScratch((root) => {
  promotePair(root, bytes({}), bytes({}), evidence());
  writeFileSync(join(root, "exported", "not-allowed.txt"), "synthetic only");
  assert.throws(() => verifyRetained(root));
  assert.ok(readFileSync(join(root, "completion.json")).length < 4096);
}));
test("META-25 unrelated transitive changes and added or removed records fail", () => {
  for (const mutate of [
    (lock) => { lock.packages["node_modules/react"].license = "CHANGED"; },
    (lock) => { lock.packages["node_modules/added"] = structuredClone(lock.packages[TARGET_PATH]); },
    (lock) => { delete lock.packages["node_modules/react"]; },
  ]) { const value = synthetic(); mutate(value.candidateLock); assert.throws(() => validate(value)); }
});
test("META-26 unchanged wrong or unpinned target version URL and SRI fail", () => {
  for (const patch of [{ version: "1.2.1" }, { version: "1.2.3" },
    { resolved: "https://registry.npmjs.org/react/-/react-19.2.8.tgz" },
    { integrity: `sha512-${Buffer.alloc(64).toString("base64")}` }]) {
    const value = synthetic(); Object.assign(value.candidateLock.packages[TARGET_PATH], patch); assert.throws(() => validate(value));
  }
  const value = synthetic(); value.candidateLock = structuredClone(value.lock); assert.throws(() => validate(value));
});
test("META-27 target metadata changes and nested duplicate targets fail", () => {
  for (const patch of [{ license: "CHANGED" }, { dev: true }, { engines: { node: "*" } }]) {
    const value = synthetic(); Object.assign(value.candidateLock.packages[TARGET_PATH], patch); assert.throws(() => validate(value));
  }
  const value = synthetic(), nested = "node_modules/next/node_modules/source-map-js";
  value.lock.packages[nested] = structuredClone(value.lock.packages[TARGET_PATH]);
  value.candidateLock.packages[nested] = structuredClone(value.candidateLock.packages[TARGET_PATH]);
  assert.throws(() => validate(value));
});
test("META-28 package reordering or whitespace cannot bypass byte identity", () => {
  const value = synthetic(), originalPackage = bytes(value.manifest), originalLock = bytes(value.lock), lock = bytes(value.candidateLock);
  const reordered = Object.fromEntries(Object.entries(value.candidatePackage).reverse());
  assert.throws(() => validateCandidate(originalPackage, originalLock, bytes(reordered), lock));
  assert.throws(() => validateCandidate(originalPackage, originalLock, Buffer.from(`${originalPackage}\n`), lock));
  assert.throws(() => validateCandidate(originalPackage, originalLock, Buffer.from(JSON.stringify(value.candidatePackage)), lock));
});
test("META-29 metadata input pins reject synthetic stale or altered originals", () => {
  assert.equal(INPUT_PACKAGE_SHA256, "4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8");
  assert.equal(INPUT_LOCK_SHA256, "bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe");
  const value = synthetic();
  assert.throws(() => validateOriginalPair(bytes(value.manifest), bytes(value.lock)));
  const stale = structuredClone(value.lock); stale.packages[TARGET_PATH].version = "1.2.0";
  assert.throws(() => validateCandidate(bytes(value.manifest), bytes(stale), bytes(value.candidatePackage), bytes(value.candidateLock)));
  assert.throws(() => validateOriginalPair(Buffer.from("{}\n"), bytes(value.lock)));
  // This read-only public fixture passes the first pin so the following
  // assertions establish that the separate lock-hash gate is also reached.
  const pinnedPackage = readFileSync("/work/package.json");
  assert.equal(sha256(pinnedPackage), INPUT_PACKAGE_SHA256);
  for (const lockBytes of [bytes(value.lock), bytes(stale)]) {
    assert.notEqual(sha256(lockBytes), INPUT_LOCK_SHA256);
    assert.throws(() => validateOriginalPair(pinnedPackage, lockBytes), {
      code: "ERR_ASSERTION", actual: sha256(lockBytes), expected: INPUT_LOCK_SHA256,
    });
  }
});
