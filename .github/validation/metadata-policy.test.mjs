// Native-only synthetic policy tests. No npm, registry, Docker, env file or DB.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { toolchainManifest, parseMetadata, sha256, validateCandidate } from "./metadata-policy.mjs";
import { decodePacket, encodePacket, EXPORT_PACKET_LIMIT, kindForAction } from "./metadata-packet.mjs";
import { readStableFile } from "./metadata-file-io.mjs";
import { requireTransferApproval } from "./metadata-approval.mjs";
import { promotePair, verifyRetained } from "./metadata-retained-check.mjs";

const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const NONCE = "a".repeat(32), COMMIT = "b".repeat(40);
const FROM = Object.freeze({ vite: "8.2.2" }), TO = Object.freeze({ vite: "8.2.4" });
const OVERRIDES = Object.freeze({ "undici@7.29.1": "7.30.1", "zod@4.4.3": "4.6.6",
  "brace-expansion@1.1.18": "1.1.21", "brace-expansion@5.0.9": "5.0.12" });
const PATCH_RECORDS = [
  ["undici", "7.29.1", "7.30.1", "node_modules/undici"],
  ["zod", "4.4.3", "4.6.6", "node_modules/zod"],
  ["brace-expansion", "1.1.18", "1.1.21", "node_modules/brace-expansion"],
  ["brace-expansion", "5.0.9", "5.0.12", "node_modules/minimatch/node_modules/brace-expansion"],
];
function synthetic() {
  const manifest = { name: "synthetic-metadata-only", version: "1.1.0-rc.1", private: true,
    engines: { node: ">=22.13.0" }, scripts: { test: "never evaluated" },
    dependencies: { next: "16.4.5", react: "19.2.9", "react-dom": "19.2.9" },
    devDependencies: { ...FROM, "eslint-config-next": "16.4.5", "react-server-dom-webpack": "19.2.9", vinext: "1.2.0",
      "@vitejs/plugin-rsc": "0.5.37", "@cloudflare/vite-plugin": "1.63.1", wrangler: "4.149.0",
      "@cloudflare/workers-types": "5.20261006.1" } };
  const pkg = (name, version) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
    integrity: `sha512-${Buffer.alloc(64).toString("base64")}` });
  const bundled = { "@emnapi/core": "1.8.1", "@emnapi/runtime": "1.8.1", "@emnapi/wasi-threads": "1.1.0",
    "@napi-rs/wasm-runtime": "1.1.1", "@tybys/wasm-util": "0.10.1", tslib: "2.8.1" };
  const parent = "node_modules/@tailwindcss/oxide-wasm32-wasi";
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { "": { name: manifest.name, version: manifest.version, dependencies: { ...manifest.dependencies },
      devDependencies: { ...manifest.devDependencies }, engines: { ...manifest.engines } },
    [parent]: { ...pkg("@tailwindcss/oxide-wasm32-wasi", "4.2.1"), dependencies: bundled, bundleDependencies: Object.keys(bundled) } } };
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    lock.packages[`node_modules/${name}`] = pkg(name, version);
  }
  for (const [name, version] of Object.entries(bundled)) lock.packages[`${parent}/node_modules/${name}`] = { version, inBundle: true };
  lock.packages["node_modules/minimatch"] = { ...pkg("minimatch", "10.2.5"), dependencies: { "brace-expansion": "^5.0.5" } };
  for (const [name, from, , path] of PATCH_RECORDS) lock.packages[path] = pkg(name, from);
  const candidatePackage = toolchainManifest(manifest), candidateLock = structuredClone(lock);
  for (const [name, version] of Object.entries(TO)) {
    candidateLock.packages[""].devDependencies[name] = version;
    candidateLock.packages[`node_modules/${name}`] = pkg(name, version);
  }
  for (const [name, , to, path] of PATCH_RECORDS) candidateLock.packages[path] = pkg(name, to);
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

test("META-01 candidate changes only exact Vite and four selector-scoped overrides", () => {
  const value = synthetic(), before = JSON.stringify(value.manifest);
  assert.deepEqual(value.candidatePackage, { ...value.manifest, devDependencies: { ...value.manifest.devDependencies, ...TO },
    overrides: OVERRIDES });
  assert.equal(JSON.stringify(value.manifest), before);
  assert.throws(() => toolchainManifest(value.candidatePackage));
  for (const overrides of [{}, OVERRIDES]) assert.throws(() => toolchainManifest({ ...value.manifest, overrides }));
  for (const name of Object.keys(FROM)) {
    for (const wrong of [undefined, "0.0.0"]) {
      const original = structuredClone(value.manifest);
      if (wrong === undefined) delete original.devDependencies[name];
      else original.devDependencies[name] = wrong;
      assert.throws(() => toolchainManifest(original));
    }
    const partial = synthetic(); partial.candidatePackage.devDependencies[name] = FROM[name];
    assert.throws(() => validate(partial));
  }
});
test("META-02 a complete synthetic graph is accepted as shape, not actual registry trust", () => {
  const value = synthetic(), before = JSON.stringify(value);
  const summary = validate(value);
  assert.equal(summary.packageSha256, sha256(bytes(value.candidatePackage)));
  assert.equal(summary.lockSha256, sha256(bytes(value.candidateLock)));
  assert.equal(summary.graph.changed, 6); // one root, Vite and four selected transitive records
  assert.equal(JSON.stringify(value), before);
  for (const name of Object.keys(TO)) {
    const wrong = synthetic(); wrong.candidateLock.packages[`node_modules/${name}`].version = FROM[name];
    assert.throws(() => validate(wrong));
  }
  for (const [name, from, , path] of PATCH_RECORDS) {
    const old = synthetic(); old.candidateLock.packages[path].version = from;
    assert.throws(() => validate(old));
    const missing = synthetic(); delete missing.candidateLock.packages[path];
    assert.throws(() => validate(missing));
    const retained = synthetic();
    retained.candidateLock.packages[`node_modules/old-target/node_modules/${name}`] = structuredClone(retained.lock.packages[path]);
    assert.throws(() => validate(retained));
  }
});
test("META-03 scripts changes cannot be smuggled into a version update", () => {
  const value = synthetic(); value.candidatePackage.scripts.test = "different";
  assert.throws(() => validate(value));
});
test("META-04 other direct dependencies remain fixed", () => {
  for (const [field, name, version] of [["dependencies", "react", "19.3.1"], ["dependencies", "next", "16.4.6"],
    ["dependencies", "react-dom", "19.2.8"], ["devDependencies", "react-server-dom-webpack", "19.2.8"],
    ["devDependencies", "eslint-config-next", "16.4.6"], ["devDependencies", "vite", "8.2.3"],
    ["devDependencies", "vinext", "1.2.1"], ["devDependencies", "@vitejs/plugin-rsc", "0.5.38"],
    ["devDependencies", "@cloudflare/vite-plugin", "1.63.2"], ["devDependencies", "wrangler", "4.150.0"],
    ["devDependencies", "@cloudflare/workers-types", "5.20261007.1"]]) {
    const value = synthetic(); value.candidatePackage[field][name] = version;
    assert.throws(() => validate(value));
  }
});
test("META-05 private engines peer optional and exact override boundary stay fixed", () => {
  for (const patch of [{ private: false }, { engines: { node: "*" } }, { workspaces: [] }, { overrides: {} },
    { peerDependencies: { react: "^19.0.0" } }, { optionalDependencies: { sharp: "0.35.5" } }]) {
    const value = synthetic(); Object.assign(value.candidatePackage, patch); assert.throws(() => validate(value));
  }
  const missing = synthetic(); delete missing.candidatePackage.overrides;
  assert.throws(() => validate(missing));
  for (const selector of Object.keys(OVERRIDES)) {
    const partial = synthetic(); delete partial.candidatePackage.overrides[selector];
    assert.throws(() => validate(partial));
  }
  for (const overrides of [
    { ...OVERRIDES, "unrelated@1.0.0": "1.0.1" },
    { ...OVERRIDES, undici: "7.30.1" },
    { ...OVERRIDES, "undici@7.29.1": "^7.30.1" },
    { ...OVERRIDES, "zod@4.4.3": "file:../outside" },
    { ...OVERRIDES, "zod@4.4.3": { ".": "4.6.6" } },
  ]) {
    const value = synthetic(); value.candidatePackage.overrides = overrides;
    assert.throws(() => validate(value));
  }
});
test("META-06 lock root metadata outside the Vite declaration stays fixed", () => {
  const value = synthetic(); value.candidateLock.packages[""].engines.node = "*";
  assert.throws(() => validate(value));
  const rootOverrides = synthetic(); rootOverrides.candidateLock.packages[""].overrides = { ...OVERRIDES };
  assert.throws(() => validate(rootOverrides));
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
  for (const url of ["http://registry.npmjs.org/react/-/react-19.2.8.tgz", "https://example.invalid/react.tgz",
    "https://user:password@registry.npmjs.org/react/-/react-19.2.8.tgz", "https://registry.npmjs.org/react/-/react-19.2.8.tgz?secret=never",
    "https://registry.npmjs.org/react/-/react-19.2.8.tgz#extra"]) {
    const value = synthetic(); value.candidateLock.packages["node_modules/react"].resolved = url; assert.throws(() => validate(value));
  }
});
test("META-10 integrity must be exact canonical SHA512 base64", () => {
  for (const integrity of ["sha256-bad", "sha512-A===", "sha512-" + "A".repeat(88), null]) {
    const value = synthetic(); value.candidateLock.packages["node_modules/react"].integrity = integrity; assert.throws(() => validate(value));
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
