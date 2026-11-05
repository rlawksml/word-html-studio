// Dedicated suite: never append these cases to the near-cap full277 command.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { verifyBackupDirectory } from "../scripts/backup-utils.mjs";
import {
  digest, IMAGE_PATH, PHOTO_BYTES, SENTINEL_BYTES, treeDigest, withWriterFixture,
} from "./helpers/backup-writer-fixture.mjs";

async function rejectedWithoutExternalWrite(fixture, code) {
  const result = await fixture.execute();
  assert.equal(result.code, 1, `${code}_MUST_REJECT`);
  assert.equal(result.complete, false, `${code}_NO_COMPLETE`);
  assert.equal(await fixture.externalDigest(), fixture.externalBefore, `${code}_EXTERNAL_SNAPSHOT_FIELDS_UNCHANGED`);
  return result;
}

test("BACKUP-PATH-01 actual CLI completes synthetic UTF8 and binary inventory", async () => {
  await withWriterFixture("normal", async (fixture) => {
    const result = await fixture.execute();
    assert.equal(result.code, 0, "BPATH01_EXIT");
    assert.equal(result.complete, true, "BPATH01_COMPLETE");
    assert.equal(result.sdkCalled && result.dummyCredentials, true, "BPATH01_FIXTURE_SDK_ONLY");
    assert.equal(await fixture.exists("INCOMPLETE"), false, "BPATH01_MARKER_REMOVED");
    assert.equal((await verifyBackupDirectory(fixture.output)).status, "PASS", "BPATH01_MANIFEST_VALID");
    const manifest = await fixture.manifest();
    assert.equal(Object.keys(manifest.database).length, 4, "BPATH01_CORE_TABLES");
    assert.equal(Object.keys(manifest.storage).length, 2, "BPATH01_TWO_BUCKETS");
    assert.equal(manifest.references.images, 1, "BPATH01_IMAGE_REFERENCE");
    const rows = JSON.parse(await readFile(path.join(fixture.output, "database/bookstores.json"), "utf8"));
    assert.equal(digest(rows[0].name), digest("가짜 책방 — 한글과 📚"), "BPATH01_UTF8_BYTES");
    for (const bucket of ["bookstore-news-originals", "bookstore-news-previews"]) {
      assert.equal(await fixture.fileHash(`storage/${bucket}/${IMAGE_PATH}`), digest(PHOTO_BYTES), "BPATH01_BINARY_BYTES");
    }
    assert.equal(await fixture.externalDigest(), fixture.externalBefore, "BPATH01_EXTERNAL_UNCHANGED");
  });
});

test("BACKUP-PATH-02 preexisting target directory and bytes stay unchanged", async () => {
  await withWriterFixture("existing-dir", async (fixture) => {
    const before = await treeDigest(fixture.output);
    await rejectedWithoutExternalWrite(fixture, "BPATH02");
    assert.equal(await treeDigest(fixture.output), before, "BPATH02_EXISTING_DIRECTORY_UNCHANGED");
  });
});

test("BACKUP-PATH-03 preexisting regular target stays unchanged", async () => {
  await withWriterFixture("existing-file", async (fixture) => {
    const before = await treeDigest(fixture.output);
    await rejectedWithoutExternalWrite(fixture, "BPATH03");
    assert.equal(await treeDigest(fixture.output), before, "BPATH03_EXISTING_FILE_UNCHANGED");
  });
});

test("BACKUP-PATH-04 lexical repository descendant is rejected without writes", async () => {
  await withWriterFixture("repository", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH04");
    assert.equal(result.sdkCalled, false, "BPATH04_NO_SDK");
  });
});

test("BACKUP-PATH-05 ancestor symlink cannot redirect actual CLI into fake repository", async () => {
  await withWriterFixture("ancestor", async (fixture) => {
    await rejectedWithoutExternalWrite(fixture, "BPATH05");
  });
});

test("BACKUP-PATH-06 world-writable output parent is rejected", async () => {
  await withWriterFixture("world", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH06");
    assert.equal(result.sdkCalled, false, "BPATH06_NO_SDK");
    assert.equal(await fixture.exists("INCOMPLETE"), false, "BPATH06_NO_TARGET_WRITE");
  });
});

test("BACKUP-PATH-07 group-writable output parent is rejected", async () => {
  await withWriterFixture("group", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH07");
    assert.equal(result.sdkCalled, false, "BPATH07_NO_SDK");
    assert.equal(await fixture.exists("INCOMPLETE"), false, "BPATH07_NO_TARGET_WRITE");
  });
});

test("BACKUP-PATH-08 missing parent is rejected instead of recursive creation", async () => {
  await withWriterFixture("missing", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH08");
    assert.equal(result.sdkCalled, false, "BPATH08_NO_SDK");
    assert.equal(await fixture.exists("", path.dirname(fixture.requested)), false, "BPATH08_PARENT_NOT_CREATED");
  });
});

test("BACKUP-PATH-09 post-init parent swap preserves external sentinel and incomplete state", async () => {
  await withWriterFixture("rename", async (fixture) => {
    const result = await fixture.execute();
    assert.equal(result.barrierRan, true, "BPATH09_DETERMINISTIC_BARRIER_REACHED");
    assert.equal(await fixture.fileHash("run/database/bookstores.json", fixture.repository), digest(SENTINEL_BYTES), "BPATH09_SENTINEL_BYTES");
    assert.equal(result.code, 1, "BPATH09_MUST_REJECT");
    assert.equal(result.complete, false, "BPATH09_NO_COMPLETE");
    assert.equal(await fixture.externalDigest(), fixture.externalBefore, "BPATH09_EXTERNAL_SENTINEL_UNCHANGED");
    assert.equal(await fixture.exists("run/INCOMPLETE", fixture.displaced), true, "BPATH09_OWN_INCOMPLETE_RETAINED");
  });
});

test("BACKUP-PATH-10 precreated payload collision is never overwritten", async () => {
  await withWriterFixture("collision", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH10");
    assert.equal(result.barrierRan, true, "BPATH10_COLLISION_INJECTED");
    assert.equal(await fixture.fileHash("database/bookstores.json"), digest(SENTINEL_BYTES), "BPATH10_COLLISION_BYTES_UNCHANGED");
    assert.equal(await fixture.exists("INCOMPLETE"), true, "BPATH10_MARKER_RETAINED");
  });
});

test("BACKUP-PATH-11 hardlinked payload cannot modify external fixture", async () => {
  await withWriterFixture("hardlink", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH11");
    assert.equal(result.barrierRan, true, "BPATH11_HARDLINK_INJECTED");
    assert.equal(await fixture.fileHash("database/bookstores.json"), digest(SENTINEL_BYTES), "BPATH11_HARDLINK_BYTES_UNCHANGED");
    assert.equal(await fixture.exists("INCOMPLETE"), true, "BPATH11_MARKER_RETAINED");
  });
});

test("BACKUP-PATH-12 FIFO payload is rejected without blocking or writing", async () => {
  await withWriterFixture("fifo", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH12");
    assert.equal(result.barrierRan, true, "BPATH12_FIFO_INJECTED");
    assert.equal(fixture.fifoBytes(), 0, "BPATH12_FIFO_RECEIVED_NO_BYTES");
    assert.equal(await fixture.exists("INCOMPLETE"), true, "BPATH12_MARKER_RETAINED");
  });
});

test("BACKUP-PATH-13 expected synthetic SDK failure retains incomplete marker", async () => {
  await withWriterFixture("sdk-error", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH13");
    assert.equal(result.sdkCalled && result.dummyCredentials, true, "BPATH13_DUMMY_SDK_FAILURE_REACHED");
    assert.equal(await fixture.exists("INCOMPLETE"), true, "BPATH13_MARKER_RETAINED");
    assert.equal(await fixture.exists("manifest.json"), false, "BPATH13_NO_COMPLETE_MANIFEST");
  });
});

test("BACKUP-PATH-14 missing dummy credentials reject before SDK or target creation", async () => {
  await withWriterFixture("missing-env", async (fixture) => {
    const result = await rejectedWithoutExternalWrite(fixture, "BPATH14");
    assert.equal(result.sdkCalled, false, "BPATH14_NO_SDK");
    assert.equal(await fixture.exists(""), false, "BPATH14_NO_TARGET_CREATED");
  });
});
