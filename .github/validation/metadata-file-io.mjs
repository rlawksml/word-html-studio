// Leaf-descriptor checks. Callers must separately prove the fixed parent
// directory (RO container mount, or private parent-owned retained directory).
import assert from "node:assert/strict";
import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

export function readStableFile(path, limit) {
  assert.ok(typeof path === "string" && isAbsolute(path));
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 3 * 1024 * 1024);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.size > 0n && before.size <= BigInt(limit));
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const amount = readSync(fd, bytes, offset, bytes.length - offset, offset);
      assert.ok(amount > 0);
      offset += amount;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, bytes.length), 0);
    const after = fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "size", "mode", "nlink", "uid", "gid", "mtimeNs", "ctimeNs"]) assert.equal(before[key], after[key]);
    return bytes;
  } finally { closeSync(fd); }
}
