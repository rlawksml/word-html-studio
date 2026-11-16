// Separate exact12 suite, never part of the existing full277 or frozen CLI14.
import assert from "node:assert/strict";
import { readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  baseEntries, BINARY, CORE, entry, identityDigest, MARKER, OPTIONAL, REQUIRED, SENTINEL,
  sha, snapshot, withProtocolFixture,
} from "./helpers/backup-writer-protocol-fixture.mjs";

async function unchanged(fixture, code) {
  assert.equal(await fixture.externalDigest(), fixture.externalBefore, `${code}_EXTERNAL_SNAPSHOT_UNCHANGED`);
}
async function rejected(raw, fixture, ack, code, expected = null) {
  assert.equal(ack.ok, false, `${code}_ACK_REJECTED`);
  if (expected !== null) assert.equal(ack.code, expected, `${code}_FIXED_FAILURE_CODE`);
  assert.equal(await raw.closed(), 1, `${code}_EXIT_FAILURE`);
  assert.equal(await fixture.markerPresent(), true, `${code}_INCOMPLETE_RETAINED`);
  await unchanged(fixture, code);
}

test("BACKUP-PROTO-01 real client serialization and original-header ledger preserve bytes", async () => {
  await withProtocolFixture(async (fixture) => {
    const entries = [...baseEntries(), ...OPTIONAL.map((relative) => entry(relative, "[]\n")),
      entry("storage/bookstore-news-originals/한글.bin", BINARY), entry("storage/bookstore-news-previews/empty.bin", Buffer.alloc(0))];
    const result = await fixture.client("success", entries, [...REQUIRED, ...OPTIONAL]);
    assert.equal(result.ok, true, "BPROTO01_CLIENT_COMPLETE");
    assert.equal(await fixture.markerPresent(), false, "BPROTO01_COMMIT_AFTER_CLOSE");
    for (const item of entries) assert.equal(await fixture.fileHash(item.path), sha(Buffer.from(item.base64, "base64")), "BPROTO01_EXACT_PAYLOAD_HASH");
    await unchanged(fixture, "BPROTO01");
  });
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    await raw.seed(baseEntries(), true); // accepted whitespace must bind its original header bytes
    assert.equal((await raw.finish()).ok, true, "BPROTO01_RAW_FINISH");
    assert.equal(await raw.closed(), 0, "BPROTO01_RAW_CLOSE_ZERO");
    assert.equal(await fixture.markerPresent(), false, "BPROTO01_RAW_MARKER_REMOVED");
  });
});

test("BACKUP-PROTO-02 duplicate puts reject without replacing the first file", async () => {
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw(), payload = Buffer.from("first synthetic bytes");
    assert.equal((await raw.put("README.txt", payload)).ok, true, "BPROTO02_FIRST_PUT");
    await rejected(raw, fixture, await raw.put("README.txt", "different"), "BPROTO02", "BACKUP_WRITER_FILE_PATH_INVALID");
    assert.equal(await fixture.fileHash("README.txt"), sha(payload), "BPROTO02_FIRST_BYTES_PRESERVED");
  });
  await withProtocolFixture(async (fixture) => {
    const result = await fixture.client("duplicate", [entry("README.txt", "first")]);
    assert.equal(result.ok, false, "BPROTO02_CLIENT_REJECTS_DUPLICATE");
    assert.equal(await fixture.fileHash("README.txt"), sha("first"), "BPROTO02_CLIENT_FIRST_BYTES_PRESERVED");
    assert.equal(await fixture.markerPresent(), true, "BPROTO02_CLIENT_MARKER_RETAINED");
  });
});

test("BACKUP-PROTO-03 traversal and malformed relative paths cannot reach external bytes", async () => {
  const paths = ["../outside", "/outside", "storage//bookstore-news-originals/x", "storage/bookstore-news-originals/a\u0000b",
    "storage\\bookstore-news-originals\\x", `storage/bookstore-news-originals/${Array(14).fill("n").join("/")}/x`];
  for (const relative of paths) await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    await rejected(raw, fixture, await raw.put(relative, "never external"), "BPROTO03", "BACKUP_WRITER_PATH_INVALID");
  });
  await withProtocolFixture(async (fixture) => {
    const result = await fixture.client("bad-path", [entry("../outside", "never external")]);
    assert.equal(result.ok, false, "BPROTO03_REAL_CLIENT_REJECTS");
    assert.equal(result.error, "BACKUP_WRITER_PATH_INVALID", "BPROTO03_REAL_CLIENT_CODE");
    await unchanged(fixture, "BPROTO03_CLIENT");
  });
  for (const marker of ["manifest.json", "INCOMPLETE"]) await withProtocolFixture(async (fixture) => {
    await writeFile(path.join(fixture.parent, marker), "synthetic existing backup metadata\n", { flag: "wx", mode: 0o600 });
    const before = await snapshot(fixture.parent);
    const result = await fixture.client("success");
    assert.equal(result.ok, false, "BPROTO03_EXISTING_BACKUP_REJECTED");
    assert.equal(result.error, "BACKUP_WRITER_EXISTING_BACKUP_ANCESTOR", "BPROTO03_EXISTING_BACKUP_CODE");
    assert.equal(await snapshot(fixture.parent), before, "BPROTO03_EXISTING_BACKUP_PARENT_UNCHANGED");
    await unchanged(fixture, "BPROTO03_EXISTING_BACKUP");
  });
});

test("BACKUP-PROTO-04 mid-payload EOF cannot remove the incomplete marker", async () => {
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw(), data = Buffer.from("partial");
    const ack = await raw.put("README.txt", data, { bytes: data.length + 3, end: true });
    await rejected(raw, fixture, ack, "BPROTO04", "BACKUP_WRITER_PAYLOAD_TRUNCATED");
  });
});

test("BACKUP-PROTO-05 a complete payload with a wrong hash remains uncommitted", async () => {
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    const ack = await raw.put("README.txt", "synthetic payload", { sha256: "0".repeat(64) });
    await rejected(raw, fixture, ack, "BPROTO05", "BACKUP_WRITER_HASH_MISMATCH");
  });
});

test("BACKUP-PROTO-06 marker replacement is rejected without deleting the replacement", async () => {
  for (const mode of ["same-bytes-new-inode", "symlink"]) await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    await raw.seed();
    const marker = path.join(fixture.output, "INCOMPLETE");
    await rename(marker, path.join(fixture.root, "held-original-marker"));
    if (mode === "same-bytes-new-inode") await writeFile(marker, MARKER, { flag: "wx", mode: 0o600 });
    else await symlink(fixture.protectedFile, marker);
    const before = await snapshot(fixture.output);
    const markerIdentity = await identityDigest(marker);
    await rejected(raw, fixture, await raw.finish(), "BPROTO06");
    assert.equal(await snapshot(fixture.output), before, "BPROTO06_FOREIGN_MARKER_ENTRY_PRESERVED");
    assert.equal(await identityDigest(marker), markerIdentity, "BPROTO06_FOREIGN_MARKER_IDENTITY_PRESERVED");
    assert.equal(sha(await readFile(fixture.protectedFile)), sha(SENTINEL), "BPROTO06_SENTINEL_BYTES");
  });
});

test("BACKUP-PROTO-07 deterministic subdirectory swap cannot redirect the next put", async () => {
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    assert.equal((await raw.put("storage/bookstore-news-originals/a.bin", BINARY)).ok, true, "BPROTO07_INITIAL_PUT");
    const storage = path.join(fixture.output, "storage");
    await rename(storage, path.join(fixture.root, "held-storage"));
    await symlink(fixture.protectedRoot, storage, "dir");
    await rejected(raw, fixture, await raw.put("storage/bookstore-news-originals/b.bin", "must not replace"), "BPROTO07");
    assert.equal(sha(await readFile(fixture.protectedFile)), sha(SENTINEL), "BPROTO07_SENTINEL_BYTES");
  });
});

test("BACKUP-PROTO-08 oversized header payload declaration and client ACK fail bounded", async () => {
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    const value = await raw.request("put", { path: `storage/bookstore-news-originals/${"x".repeat(8200)}`, bytes: 0, sha256: sha("") });
    await rejected(raw, fixture, value.ack, "BPROTO08_HEADER", "BACKUP_WRITER_HEADER_INVALID");
  });
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    const value = await raw.request("put", { path: "README.txt", bytes: 64 * 1024 * 1024 + 1, sha256: sha("") });
    await rejected(raw, fixture, value.ack, "BPROTO08_PAYLOAD", "BACKUP_WRITER_PAYLOAD_LIMIT");
  });
  await withProtocolFixture(async (fixture) => {
    const result = await fixture.client("success");
    assert.equal(result.ok, false, "BPROTO08_CLIENT_ACK_REJECTED");
    assert.equal(result.error, "BACKUP_WRITER_ACK_LIMIT", "BPROTO08_CLIENT_ACK_CODE");
    await unchanged(fixture, "BPROTO08_ACK");
  }, "oversize-ack");
});

test("BACKUP-PROTO-09 finish rejects missing required files and forged ledger counters", async () => {
  for (const mode of ["missing", "empty", "core", "optional", "files", "bytes", "ledger", "reserialized"]) {
    await withProtocolFixture(async (fixture) => {
      const raw = await fixture.raw();
      const entries = mode === "missing" ? baseEntries().filter((item) => item.path !== "README.txt")
        : mode === "optional" ? [...baseEntries(), entry(OPTIONAL[0], "[]\n")] : baseEntries();
      await raw.seed(entries, mode === "reserialized");
      const overrides = mode === "empty" ? { required: [] }
        : mode === "core" ? { required: REQUIRED.filter((item) => item !== CORE[0]) }
          : mode === "files" ? { files: 10001 } : mode === "bytes" ? { bytes: 4 * 1024 ** 3 + 1 }
            : mode === "ledger" ? { ledger: "0".repeat(64) }
              : mode === "reserialized" ? { ledger: raw.reserializedLedger() } : {};
      await rejected(raw, fixture, await raw.finish(overrides), "BPROTO09");
    });
  }
});

test("BACKUP-PROTO-10 post-finish requests and trailing input cannot claim success", async () => {
  await withProtocolFixture(async (fixture) => {
    const result = await fixture.client("after-finish");
    assert.equal(result.ok, true, "BPROTO10_INITIAL_FINISH");
    assert.deepEqual(result.codes, ["BACKUP_WRITER_STATE_INVALID", "BACKUP_WRITER_STATE_INVALID"], "BPROTO10_NO_POST_FINISH_OPERATION");
    assert.equal(await fixture.markerPresent(), false, "BPROTO10_COMPLETE_STAYS_COMPLETE");
    assert.equal(await fixture.fileHash("README.txt"), sha(Buffer.from(baseEntries().find((item) => item.path === "README.txt").base64, "base64")), "BPROTO10_BYTES_UNCHANGED");
    await unchanged(fixture, "BPROTO10_CLIENT");
  });
  await withProtocolFixture(async (fixture) => {
    const raw = await fixture.raw();
    await raw.seed();
    await rejected(raw, fixture, await raw.finish({}, Buffer.from("unexpected trailing byte")), "BPROTO10_TRAILING", "BACKUP_WRITER_TRAILING_INPUT");
  });
});

test("BACKUP-PROTO-11 idle close and pending cancellation leave no live owned process", async () => {
  await withProtocolFixture(async (fixture) => {
    const result = await fixture.client("cancel-idle");
    assert.equal(result.ok, true, "BPROTO11_IDLE_CLOSE");
    assert.deepEqual(result.codes, ["BACKUP_WRITER_STATE_INVALID"], "BPROTO11_IDLE_STATE");
    assert.equal(await fixture.markerPresent(), true, "BPROTO11_IDLE_MARKER_RETAINED");
    await unchanged(fixture, "BPROTO11_IDLE");
  });
  await withProtocolFixture(async (fixture) => {
    const result = await fixture.client("cancel-pending");
    assert.equal(result.ok, true, "BPROTO11_CANCEL_COMPLETED");
    assert.deepEqual(result.codes, ["BACKUP_WRITER_CANCELLED", null], "BPROTO11_PENDING_REJECTED_AND_CLOSE_SETTLED");
    assert.equal(await fixture.markerPresent(), true, "BPROTO11_CANCEL_MARKER_RETAINED");
    await unchanged(fixture, "BPROTO11_PENDING");
  }, "hold-put");
});

test("BACKUP-PROTO-12 concurrent client puts are serialized snapshotted and sealed before finish", async () => {
  await withProtocolFixture(async (fixture) => {
    const entries = [...baseEntries(), entry("storage/bookstore-news-originals/one.bin", BINARY),
      entry("storage/bookstore-news-previews/two.bin", "둘째 파일\n"), entry("migrations/fixture.sql", "-- synthetic only\n")];
    const result = await fixture.client("concurrent", entries);
    assert.equal(result.ok, true, "BPROTO12_ALL_QUEUED_PUTS_FINISHED");
    assert.equal(await fixture.markerPresent(), false, "BPROTO12_FINISH_AFTER_QUEUE");
    for (const item of entries) assert.equal(await fixture.fileHash(item.path), sha(Buffer.from(item.base64, "base64")), "BPROTO12_EXACT_SNAPSHOT_BYTES");
    await unchanged(fixture, "BPROTO12");
  });
});
