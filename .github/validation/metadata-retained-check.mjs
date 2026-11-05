// Parent-owned promotion after exact cleanup, plus an immediate pre-upload
// check. Neither this directory nor its descriptors enter any container.
import assert from "node:assert/strict";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, writeSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readStableFile } from "./metadata-file-io.mjs";
import { METADATA_LIMITS, parseMetadata, sha256 } from "./metadata-policy.mjs";

const FILES = ["package.json", "package-lock.json"];
function privateDirectory(path) {
  assert.equal(realpathSync(path), path);
  const info = lstatSync(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700);
}
function exclusiveFile(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.size === 0n);
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0);
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    assert.ok(after.isFile() && after.nlink === 1n && after.size === BigInt(bytes.length)
      && after.dev === before.dev && after.ino === before.ino && after.uid === before.uid && after.gid === before.gid);
  } finally { closeSync(fd); }
}
export function promotePair(scratch, packageBytes, lockBytes, evidence, write = exclusiveFile) {
  privateDirectory(scratch);
  assert.equal(evidence.cleaned, true);
  assert.ok(typeof evidence.commit === "string" && evidence.commit.length === 40 && /^[a-f0-9]{40}$/.test(evidence.commit));
  assert.ok(typeof evidence.nonce === "string" && evidence.nonce.length === 32 && /^[a-f0-9]{32}$/.test(evidence.nonce));
  assert.equal(typeof write, "function"); // only a unit-test fault adapter; never a CLI option
  parseMetadata(packageBytes, "package");
  parseMetadata(lockBytes, "lock");
  const directory = join(scratch, "exported");
  mkdirSync(directory, { mode: 0o700 }); // pre-existing output is a blocker
  write(join(directory, FILES[0]), packageBytes);
  write(join(directory, FILES[1]), lockBytes);
  // No completion record/output exists if either write throws. Partial private
  // output is not uploaded or used as a successful result; runner disposal owns it.
  const completion = { protocol: "metadata-retained-v1", commit: evidence.commit, nonce: evidence.nonce, cleaned: true,
    package: { bytes: packageBytes.length, sha256: sha256(packageBytes) },
    lock: { bytes: lockBytes.length, sha256: sha256(lockBytes) } };
  exclusiveFile(join(scratch, "completion.json"), Buffer.from(`${JSON.stringify(completion)}\n`));
  return verifyRetained(scratch);
}
export function verifyRetained(scratch) {
  privateDirectory(scratch);
  const completion = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readStableFile(join(scratch, "completion.json"), 4096)));
  assert.deepEqual(Object.keys(completion), ["protocol", "commit", "nonce", "cleaned", "package", "lock"]);
  assert.equal(completion.protocol, "metadata-retained-v1");
  assert.equal(completion.cleaned, true);
  assert.ok(typeof completion.commit === "string" && completion.commit.length === 40 && /^[a-f0-9]{40}$/.test(completion.commit));
  assert.ok(typeof completion.nonce === "string" && completion.nonce.length === 32 && /^[a-f0-9]{32}$/.test(completion.nonce));
  const directory = join(scratch, "exported");
  privateDirectory(directory);
  assert.deepEqual(readdirSync(directory).sort(), [...FILES].sort());
  for (const [index, kind] of ["package", "lock"].entries()) {
    const declared = completion[kind];
    assert.deepEqual(Object.keys(declared), ["bytes", "sha256"]);
    const bytes = readStableFile(join(directory, FILES[index]), METADATA_LIMITS[kind]);
    assert.equal(bytes.length, declared.bytes);
    assert.equal(sha256(bytes), declared.sha256);
    parseMetadata(bytes, kind);
  }
  return completion;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    verifyRetained(process.argv[2]);
    console.log("METADATA_RETAINED_PREUPLOAD_CHECK_PASS files=2");
  } catch { console.error("METADATA_RETAINED_PREUPLOAD_CHECK_FAILED"); process.exitCode = 1; }
}
