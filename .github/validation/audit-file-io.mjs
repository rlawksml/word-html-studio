// Fixed RO input files only. Caller proves the parent is a readonly image dir.
import assert from "node:assert/strict";
import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { LOCK_SHA256, PACKAGE_SHA256 } from "./offline-baseline.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function readStableFile(path, limit) {
  assert.ok(typeof path === "string" && path.startsWith("/") && Number.isSafeInteger(limit) && limit > 0 && limit <= 2 * 1024 * 1024);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.size > 0n && before.size <= BigInt(limit));
    const data = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < data.length) {
      const amount = readSync(fd, data, offset, data.length - offset, offset);
      assert.ok(amount > 0);
      offset += amount;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, data.length), 0);
    const after = fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "size", "mode", "nlink", "uid", "gid", "mtimeNs", "ctimeNs"]) assert.equal(before[key], after[key]);
    return data;
  } finally { closeSync(fd); }
}
export function readInputPair() {
  const packageBytes = readStableFile("/input/package.json", 65536);
  const lockBytes = readStableFile("/input/package-lock.json", 2 * 1024 * 1024);
  assert.equal(sha256(packageBytes), PACKAGE_SHA256);
  assert.equal(sha256(lockBytes), LOCK_SHA256);
  return { packageBytes, lockBytes };
}
