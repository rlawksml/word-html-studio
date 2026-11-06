// Run from reviewed source only. Never load JS or configuration from the archive.
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { COMPILED_OUTPUT_LIMIT } from "../.github/validation/offline-host-support.mjs";
import { STAGING_ARTIFACT_FILE, readArtifactFile, verifyCompiledArtifact } from "../.github/validation/staging-compiled-artifact.mjs";

function requirePrivateParent(path) {
  const parent = dirname(path);
  assert.equal(realpathSync(parent), parent);
  const info = lstatSync(parent);
  assert.ok(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o077) === 0);
}

try {
  const [input, destination, archiveSha, commit, sourceSha256, packageSha256, lockSha256, tests, workerTests, ...extra] = process.argv.slice(2);
  assert.ok(!extra.length && input && destination && resolve(input) === input && resolve(destination) === destination);
  assert.equal(basename(input), STAGING_ARTIFACT_FILE);
  assert.match(archiveSha, /^[a-f0-9]{64}$/);
  for (const count of [tests, workerTests]) assert.match(count, /^[1-9]\d{0,5}$/);
  requirePrivateParent(input);
  requirePrivateParent(destination);
  const archive = readArtifactFile(input, COMPILED_OUTPUT_LIMIT);
  const verified = verifyCompiledArtifact(archive, { commit, sourceSha256, packageSha256, lockSha256, tests: Number(tests), workerTests: Number(workerTests) });
  assert.equal(verified.sha256, archiveSha);
  mkdirSync(destination, { mode: 0o700 }); // never overwrite or populate an existing destination
  assert.equal(realpathSync(destination), destination);
  for (const file of verified.files) {
    const target = join(destination, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.bytes, { flag: "wx", mode: 0o600 });
  }
  console.log(`STAGING_COMPILED_EXTRACTED sha256=${verified.sha256} files=${verified.files.length} bytes=${verified.bytes}`);
} catch {
  console.error("STAGING_COMPILED_EXTRACTION_BLOCKED");
  process.exitCode = 1;
}
