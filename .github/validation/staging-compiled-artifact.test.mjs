import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256 } from "./offline-host-support.mjs";
import { collectCompiledArtifact, STAGING_ARTIFACT_FILE, stagingArtifactPathHint, validateStagingTransfer, verifyCompiledArtifact } from "./staging-compiled-artifact.mjs";

const verified = Object.freeze({
  commit: "0".repeat(40), sourceSha256: "1".repeat(64), packageSha256: "2".repeat(64),
  lockSha256: "3".repeat(64), tests: 277, workerTests: 36,
});
const writer = fileURLToPath(new URL("../../scripts/extract-staging-compiled.mjs", import.meta.url));
const assets = Object.freeze({
  "dist/server/index.js": "// SYNTHETIC ENTRY",
  "dist/server/BUILD_ID": "fixture-build-id",
  "dist/server/RSC_BUILD_ID": "fixture-rsc-build-id",
  "dist/server/ssr/assets/render-xyz.js": "// SYNTHETIC CHUNK",
  "dist/server/_next/static/chunks/server-xyz.css": "body { color: black }",
  "dist/client/_next/static/main-xyz.js": "// SYNTHETIC CLIENT",
  "dist/client/_next/static/main-xyz.css": "main { display:block }",
  "dist/client/.assetsignore": "/.vite",
  "dist/client/vinext-client-entry-manifest.json": '{"appBrowserEntry":"_next/static/main-xyz.js"}',
  "dist/client/guides/bookstore-news-input-guide.pdf": "SYNTHETIC PUBLIC ASSET",
});
const failure = (safeCode) => (error) => error?.safeCode === safeCode && error.message === safeCode && error.cause === undefined;

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bookstore-compiled-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
    return target;
  };
  for (const [path, value] of Object.entries(assets)) write(path, value);
  write("public/guides/bookstore-news-input-guide.pdf", assets["dist/client/guides/bookstore-news-input-guide.pdf"]);
  return { root, write, archive: () => collectCompiledArtifact(root, verified, join(root, "public")) };
}

function replaceManifest(buffer, rewrite) {
  const oldSize = buffer.readUInt32BE(0);
  const manifest = JSON.parse(buffer.subarray(4, 4 + oldSize));
  rewrite(manifest);
  const raw = Buffer.from(JSON.stringify(manifest)), prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(raw.length);
  return Buffer.concat([prefix, raw, buffer.subarray(4 + oldSize)]);
}

function replacePayload(buffer, path, value) {
  const oldSize = buffer.readUInt32BE(0);
  const oldStart = 4 + oldSize;
  const replacement = Buffer.from(value);
  let relativeOffset = 0, oldLength;
  const rewritten = replaceManifest(buffer, (manifest) => {
    for (const file of manifest.files) {
      if (file.path === path) {
        oldLength = file.bytes;
        manifest.total += replacement.length - oldLength;
        Object.assign(file, { bytes: replacement.length, sha256: sha256(replacement) });
        return;
      }
      relativeOffset += file.bytes;
    }
    assert.fail("synthetic path was not found");
  });
  const newStart = 4 + rewritten.readUInt32BE(0);
  return Buffer.concat([
    rewritten.subarray(0, newStart), buffer.subarray(oldStart, oldStart + relativeOffset),
    replacement, buffer.subarray(oldStart + relativeOffset + oldLength),
  ]);
}

test("STAGE-ARTIFACT-01 transfer defaults off and requires explicit fresh UTC verification", () => {
  const time = "2026-11-06T00:00:00.000Z", now = Date.parse(time);
  assert.equal(validateStagingTransfer("false", "", now), false);
  assert.equal(validateStagingTransfer("true", time, now + 3_600_000), true);
  for (const [approved, at, current] of [
    ["true", "", now], ["false", time, now], [true, time, now],
    ["true", time, now - 1], ["true", time, now + 3_600_001],
    ["true", "2026-11-31T00:00:00.000Z", now], ["true", "2026-11-06T00:00:00Z", now],
  ]) assert.throws(() => validateStagingTransfer(approved, at, current));
});

test("STAGE-ARTIFACT-02 deterministic framing retains only allowlisted files in fixed build roots", (t) => {
  const { write, archive } = fixture(t);
  write("dist/server/wrangler.json", '{"not-transferred":"configuration"}');
  write("dist/server/.dev.vars", "DUMMY_VALUE=not-transferred");
  const privateBuildKey = "f".repeat(64);
  for (const path of ["dist/server/vinext-server.json", "dist/server/ssr/vinext-server.json"]) {
    write(path, JSON.stringify({ prerenderSecret: privateBuildKey }));
  }
  write("dist/root-source.js", "not transferred");
  write(".env", "not transferred");
  const first = archive(), second = archive();
  assert.ok(first.equals(second));
  const receipt = verifyCompiledArtifact(first, verified);
  assert.deepEqual(receipt.files.map(({ path }) => path), Object.keys(assets).sort());
  assert.equal(receipt.sha256, sha256(first));
  assert.ok(!first.includes("not-transferred") && !first.includes("not transferred"));
  assert.ok(!first.includes(privateBuildKey));
  write("dist/server/index.js", `const fixture = '${privateBuildKey}';`);
  assert.throws(archive, failure("ARTIFACT_BUILD_SECRET"));
});

test("STAGE-ARTIFACT-03 copy of a tracked public asset must match its pinned source bytes", (t) => {
  const { write, archive } = fixture(t);
  write("dist/client/guides/bookstore-news-input-guide.pdf", "REPLACED FIXTURE");
  assert.throws(archive, failure("ARTIFACT_PUBLIC_MISMATCH"));
});

test("STAGE-ARTIFACT-04 source maps and credential-shaped files do not leave the sandbox", (t) => {
  const { write, archive } = fixture(t);
  assert.equal(stagingArtifactPathHint("dist/client/.vite/new-manifest.json"), "dist/client/.vite/new-manifest.json");
  for (const path of ["dist/server/.env", "dist/server/api-token.js", "dist/client/../raw.js", "dist/client/asset\n.js"]) {
    assert.equal(stagingArtifactPathHint(path), null);
  }
  for (const path of ["dist/client/assets/raw.js.map", "dist/server/.env", "dist/server/assets/auth-secret.js", "dist/client/assets/upload/data.js"]) {
    const invalid = write(path, "SYNTHETIC FIXTURE");
    assert.throws(archive, failure(path.includes("/upload/") ? "ARTIFACT_DIRECTORY_LAYOUT" : "ARTIFACT_PATH_LAYOUT"));
    rmSync(invalid);
    if (path.includes("/upload/")) rmSync(dirname(invalid), { recursive: true });
  }
  write("dist/client/new-manifest.json", "NEVER READ 1");
  write("dist/server/.env", "NEVER READ 2");
  write("dist/server/new-manifest.json", "NEVER READ 3");
  assert.throws(archive, (error) => {
    assert.ok(failure("ARTIFACT_PATH_LAYOUT")(error));
    assert.deepEqual(error.pathHints, ["dist/client/new-manifest.json", "dist/server/new-manifest.json"]);
    return true;
  });
});

test("STAGE-ARTIFACT-05 linked directories, symlinks and hardlinks fail closed", (t) => {
  const { root, archive, write } = fixture(t);
  const target = write("outside.js", "SYNTHETIC FIXTURE");
  const destination = join(root, "dist/server/link.js");
  symlinkSync(target, destination);
  assert.throws(archive, failure("ARTIFACT_ENTRY_UNSAFE"));
  rmSync(destination);
  linkSync(target, destination);
  assert.throws(archive, failure("ARTIFACT_FILE_UNSAFE"));
  rmSync(destination);
  renameSync(join(root, "dist/client"), join(root, "moved"));
  symlinkSync(join(root, "moved"), join(root, "dist/client"));
  assert.throws(archive, failure("ARTIFACT_ROOT_UNSAFE"));
});

test("STAGE-ARTIFACT-06 oversize files are rejected before copying their bytes", (t) => {
  const { write, archive } = fixture(t);
  truncateSync(write("dist/server/large.js", ""), 16 * 1024 * 1024 + 1);
  assert.throws(archive, failure("ARTIFACT_FILE_UNSAFE"));
});

test("STAGE-ARTIFACT-07 receiver rejects a wrong commit, lock, source, package or counter", (t) => {
  const { archive } = fixture(t);
  const binary = archive();
  for (const [field, value] of Object.entries(verified)) {
    assert.throws(() => verifyCompiledArtifact(binary, { ...verified, [field]: typeof value === "string" ? "4".repeat(value.length) : value - 1 }));
  }
});

test("STAGE-ARTIFACT-08 file corruption and trailing or truncated bytes fail verification", (t) => {
  const { archive } = fixture(t);
  const binary = archive(), corrupt = Buffer.from(binary);
  corrupt[corrupt.length - 1] ^= 1;
  for (const bad of [corrupt, binary.subarray(0, -1), Buffer.concat([binary, Buffer.from("extra")])]) {
    assert.throws(() => verifyCompiledArtifact(bad, verified), failure("ARTIFACT_ARCHIVE_INVALID"));
  }
});

test("STAGE-ARTIFACT-09 receiver rejects traversal, duplicate, case alias and invalid roots", (t) => {
  const { archive } = fixture(t);
  const binary = archive();
  for (const path of ["../secret.js", "dist/client/_next/static/../../../secret.js", "dist/server/node_modules/file.js", "/dist/server/index.js", "dist/server/with\\slash.js"]) {
    assert.throws(() => verifyCompiledArtifact(replaceManifest(binary, (manifest) => { manifest.files[0].path = path; }), verified));
  }
  assert.throws(() => verifyCompiledArtifact(replaceManifest(binary, (manifest) => { manifest.files[1].path = manifest.files[0].path; }), verified));
  assert.throws(() => verifyCompiledArtifact(replaceManifest(binary, (manifest) => {
    manifest.files[1].path = "dist/client/_next/static/A/x.css";
    manifest.files[2].path = "dist/client/_next/static/a/x.js";
  }), verified));
  assert.throws(() => verifyCompiledArtifact(replaceManifest(binary, (manifest) => {
    manifest.files[2].path = `${manifest.files[1].path}/x.js`;
  }), verified));
});

test("STAGE-ARTIFACT-10 manifest validation requires the real entry and JS/CSS assets", (t) => {
  const { root, archive } = fixture(t);
  for (const [path, kind] of [
    ["dist/server/index.js", "ARTIFACT_REQUIRED_SERVER"],
    ["dist/client/_next/static/main-xyz.js", "ARTIFACT_REQUIRED_JS"],
    ["dist/client/_next/static/main-xyz.css", "ARTIFACT_REQUIRED_CSS"],
  ]) {
    const absolute = join(root, path);
    rmSync(absolute);
    assert.throws(() => verifyCompiledArtifact(archive(), verified), failure(kind));
    writeFileSync(absolute, assets[path]);
  }
});

test("STAGE-ARTIFACT-11 local receiver validates before writing, never executes JS or overwrites a destination", (t) => {
  const { root, write, archive } = fixture(t);
  const badEntrypoint = 'throw new Error("MUST NOT EXECUTE COMPILED CODE");';
  write("dist/server/index.js", badEntrypoint);
  const binary = archive();
  const file = write(STAGING_ARTIFACT_FILE, binary), destination = join(root, "verified-target");
  const args = [file, destination, sha256(binary), ...Object.values(verified).map(String)];
  assert.notEqual(spawnSync(process.execPath, [writer, ...args.map((value, index) => index === 2 ? "4".repeat(64) : value)]).status, 0);
  assert.equal(existsSync(destination), false);
  assert.equal(execFileSync(process.execPath, [writer, ...args], { encoding: "utf8" }),
    `STAGING_COMPILED_EXTRACTED sha256=${sha256(binary)} files=${Object.keys(assets).length} bytes=${binary.length}\n`);
  assert.equal(readFileSync(join(destination, "dist/server/index.js"), "utf8"), badEntrypoint);
  assert.notEqual(spawnSync(process.execPath, [writer, ...args]).status, 0);
  assert.equal(readFileSync(join(destination, "dist/server/index.js"), "utf8"), badEntrypoint);
});

test("STAGE-ARTIFACT-12 exporter and receiver reject inline data source maps in JS and CSS", (t) => {
  const { write, archive } = fixture(t);
  const binary = archive();
  for (const [path, value] of [
    ["dist/server/index.js", "entry();\n//# sourceMappingURL=data:application/json;base64,e30="],
    ["dist/client/_next/static/main-xyz.js", "client();\n//@  sourceMappingURL = DATA:application/json,%7B%7D"],
    ["dist/client/_next/static/main-xyz.css", "main{}\n/*# sourceMappingURL=data:application/json;base64,e30= */"],
  ]) {
    // An intentionally re-sealed archive still must fail on content, not hash drift.
    assert.throws(() => verifyCompiledArtifact(replacePayload(binary, path, value), verified), failure("ARTIFACT_INLINE_MAP"));
    write(path, value);
    assert.throws(archive, failure("ARTIFACT_INLINE_MAP"));
    write(path, assets[path]);
  }
  write("dist/server/index.js", "entry();\n//# sourceMappingURL=outside.js.map");
  assert.equal(verifyCompiledArtifact(archive(), verified).files.length, Object.keys(assets).length);
});

test("STAGE-ARTIFACT-13 receiver requires user-private non-symlink input and output parents", (t) => {
  const { root, write, archive } = fixture(t);
  const binary = archive();
  const file = write(STAGING_ARTIFACT_FILE, binary), shared = join(root, "shared"), alias = join(root, "alias");
  const sharedFile = write(`shared/${STAGING_ARTIFACT_FILE}`, binary);
  chmodSync(shared, 0o755);
  symlinkSync(root, alias);
  for (const [input, destination] of [
    [sharedFile, join(root, "verified-target")],
    [file, join(shared, "verified-target")],
    [join(alias, STAGING_ARTIFACT_FILE), join(root, "verified-target")],
    [file, join(alias, "verified-target")],
  ]) {
    const args = [input, destination, sha256(binary), ...Object.values(verified).map(String)];
    assert.notEqual(spawnSync(process.execPath, [writer, ...args]).status, 0);
    assert.equal(existsSync(destination), false);
  }
});
