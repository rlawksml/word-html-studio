import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { canonicalJson, sha256, verifyBackupDirectory } from "../scripts/backup-utils.mjs";
import { tableSpecsForRestore } from "../scripts/supabase-schema.mjs";
import {
  CORE_BACKUP_TABLES, FIXTURE_PHOTO_PATH, ORIGINAL_BUCKET, PREVIEW_BUCKET,
  withBackupFixture,
} from "./helpers/backup-directory-fixture.mjs";

async function expectFail(fixture) {
  await fixture.writeManifest();
  const result = await verifyBackupDirectory(fixture.root);
  assert.equal(result.status, "FAIL", "incomplete or inconsistent backup must not pass");
  assert.ok(result.failures.length > 0);
}

test("BACKUP-COMPLETE-01 empty manifest lists cannot certify an empty restore", async () => {
  await withBackupFixture({}, async (fixture) => {
    fixture.manifest.database = {};
    fixture.manifest.storage = {};
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-02 each legacy core table is required even when all rows are empty", async () => {
  for (const table of CORE_BACKUP_TABLES) {
    await withBackupFixture({}, async (fixture) => {
      delete fixture.manifest.database[table];
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-03 restore table planning rejects absent core tables", () => {
  for (const omitted of CORE_BACKUP_TABLES) {
    const database = Object.fromEntries(CORE_BACKUP_TABLES.filter((name) => name !== omitted).map((name) => [name, {}]));
    assert.throws(() => tableSpecsForRestore(database));
  }
  assert.throws(() => tableSpecsForRestore({}));
});

test("BACKUP-COMPLETE-04 marker and schedule tables must be included together", async () => {
  for (const omitted of ["app_schema_versions", "news_schedule_ranges"]) {
    await withBackupFixture({ schema: "modern" }, async (fixture) => {
      delete fixture.manifest.database[omitted];
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-05 restore planner rejects partial optional table bundles", () => {
  const base = Object.fromEntries(CORE_BACKUP_TABLES.map((name) => [name, {}]));
  for (const optional of ["app_schema_versions", "news_schedule_ranges", "monthly_digest_orders"]) {
    assert.throws(() => tableSpecsForRestore({ ...base, [optional]: {} }));
  }
});

test("BACKUP-COMPLETE-06 digest capability requires its data table", async () => {
  await withBackupFixture({ schema: "digest" }, async (fixture) => {
    delete fixture.manifest.database.monthly_digest_orders;
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-07 digest table requires its matching capability marker", async () => {
  await withBackupFixture({ schema: "digest" }, async (fixture) => {
    await fixture.writeTable("app_schema_versions", fixture.rows.app_schema_versions.filter((row) => row.component !== "digest_order"));
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-08 duplicate and unsupported digest markers cannot certify completeness", async () => {
  for (const mutation of ["duplicate", "version"]) {
    await withBackupFixture({ schema: "digest" }, async (fixture) => {
      const rows = structuredClone(fixture.rows.app_schema_versions);
      if (mutation === "duplicate") rows.push({ ...rows[1] });
      else rows[1].version += 1;
      await fixture.writeTable("app_schema_versions", rows);
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-09 original and preview bucket inventories are mandatory", async () => {
  for (const bucket of [ORIGINAL_BUCKET, PREVIEW_BUCKET]) {
    await withBackupFixture({}, async (fixture) => {
      delete fixture.manifest.storage[bucket];
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-10 completion timestamps are mandatory and ordered", async () => {
  for (const mutate of [
    (manifest) => { delete manifest.completedAt; },
    (manifest) => { manifest.createdAt = "not-a-date"; },
    (manifest) => { manifest.completedAt = "2026-02-30T00:00:00.000Z"; },
    (manifest) => { manifest.completedAt = "2026-11-04T23:59:59.000Z"; },
  ]) {
    await withBackupFixture({}, async (fixture) => {
      mutate(fixture.manifest);
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-11 source fingerprint must be the exact non-secret identifier shape", async () => {
  for (const fingerprint of [undefined, "", "A".repeat(16), "1".repeat(15), "1".repeat(17)]) {
    await withBackupFixture({}, async (fixture) => {
      fixture.manifest.sourceProjectFingerprint = fingerprint;
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-12 unknown table and bucket inventory names fail closed", async () => {
  for (const section of ["database", "storage"]) {
    await withBackupFixture({}, async (fixture) => {
      fixture.manifest[section].unknown_inventory = section === "database"
        ? { rows: 0, bytes: 3, sha256: sha256("[]\n") }
        : { objects: [], objectCount: 0, totalBytes: 0, pathsSha256: sha256("[]\n") };
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-13 malformed table metadata fails instead of accepting coercion", async () => {
  for (const patch of [{ rows: "0" }, { rows: -1 }, { rows: 0.5 }, { bytes: -1 }, { sha256: "not-a-hash" }]) {
    await withBackupFixture({}, async (fixture) => {
      Object.assign(fixture.manifest.database.bookstores, patch);
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-14 bucket object count and total bytes are independently checked", async () => {
  for (const patch of [{ objectCount: 0 }, { objectCount: "1" }, { totalBytes: 0 }, { totalBytes: -1 }]) {
    await withBackupFixture({ images: true }, async (fixture) => {
      Object.assign(fixture.manifest.storage[ORIGINAL_BUCKET], patch);
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-15 bucket path digests and duplicate object paths are checked", async () => {
  for (const mutation of ["digest", "duplicate"]) {
    await withBackupFixture({ images: true }, async (fixture) => {
      const bucket = fixture.manifest.storage[ORIGINAL_BUCKET];
      if (mutation === "digest") bucket.pathsSha256 = "0".repeat(64);
      else {
        bucket.objects.push({ ...bucket.objects[0] });
        bucket.objectCount = 2;
        bucket.totalBytes *= 2;
        bucket.pathsSha256 = sha256(canonicalJson(bucket.objects.map((object) => object.path)));
      }
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-16 reference statistics cannot be erased or forged", async () => {
  for (const mutation of ["absent", "empty", "counter", "missing-counter"]) {
    await withBackupFixture({ images: true }, async (fixture) => {
      if (mutation === "absent") delete fixture.manifest.references;
      else if (mutation === "empty") fixture.manifest.references = {};
      else if (mutation === "counter") fixture.manifest.references.images = 0;
      else delete fixture.manifest.references.uniquePreviewPaths;
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-17 database references expose a missing original despite an empty declared list", async () => {
  await withBackupFixture({ images: true }, async (fixture) => {
    fixture.clearBucketInventory(ORIGINAL_BUCKET);
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-18 database references expose a missing preview despite an empty declared list", async () => {
  await withBackupFixture({ images: true }, async (fixture) => {
    fixture.clearBucketInventory(PREVIEW_BUCKET);
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-19 accurate reporting of a missing referenced photo still blocks restore", async () => {
  await withBackupFixture({ images: true }, async (fixture) => {
    fixture.clearBucketInventory(ORIGINAL_BUCKET);
    fixture.manifest.references.missingOriginalObjects = [FIXTURE_PHOTO_PATH];
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-20 retained unreferenced photos stay a blocker, never an instruction to delete", async () => {
  await withBackupFixture({ images: true }, async (fixture) => {
    await fixture.writeTable("submissions", []);
    fixture.manifest.references = {
      newsItems: 0, images: 0, originalPaths: 0, uniqueOriginalPaths: 0,
      previewPaths: 0, uniquePreviewPaths: 0,
      missingOriginalObjects: [], missingPreviewObjects: [],
      unreferencedOriginalObjects: [FIXTURE_PHOTO_PATH],
      unreferencedPreviewObjects: [FIXTURE_PHOTO_PATH],
    };
    const photo = path.join(fixture.root, "storage", ORIGINAL_BUCKET, FIXTURE_PHOTO_PATH);
    const before = await readFile(photo);
    await expectFail(fixture);
    assert.deepEqual(await readFile(photo), before);
  });
});

test("BACKUP-COMPLETE-21 complete legacy backups may contain zero rows and zero photos", async () => {
  await withBackupFixture({}, async (fixture) => {
    assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");
    assert.deepEqual(tableSpecsForRestore(fixture.manifest.database).map((table) => table.name), CORE_BACKUP_TABLES);
  });
});

test("BACKUP-COMPLETE-22 complete modern and digest bundles both pass without rewriting rows", async () => {
  for (const schema of ["modern", "digest"]) {
    await withBackupFixture({ schema }, async (fixture) => {
      const before = await fixture.snapshot();
      assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");
      assert.deepEqual(await fixture.snapshot(), before);
    });
  }
});

test("BACKUP-COMPLETE-23 valid image references and unknown future row fields remain byte-identical", async () => {
  await withBackupFixture({ schema: "digest", images: true }, async (fixture) => {
    const before = await fixture.snapshot();
    assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");
    assert.deepEqual(await fixture.snapshot(), before);
  });
});

test("BACKUP-COMPLETE-24 payload tampering and an INCOMPLETE marker cannot pass", async () => {
  for (const mutation of ["payload", "incomplete"]) {
    await withBackupFixture({}, async (fixture) => {
      if (mutation === "payload") await writeFile(path.join(fixture.root, "database", "bookstores.json"), "[{}]\n");
      else await writeFile(path.join(fixture.root, "INCOMPLETE"), "synthetic only\n");
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-25 malformed news and images cannot conceal database photo references", async () => {
  for (const news of [{}, [{ id: 2, images: {} }], [{ id: 2, images: [null] }]]) {
    await withBackupFixture({}, async (fixture) => {
      await fixture.writeTable("submissions", [{ id: 1, news }]);
      await expectFail(fixture);
    });
  }
});

test("BACKUP-COMPLETE-26 reused photo references are counted separately from unique stored paths", async () => {
  await withBackupFixture({ images: true }, async (fixture) => {
    const news = fixture.rows.submissions[0].news[0];
    await fixture.writeTable("submissions", [{ id: 1, news: [news, { ...news, id: 4 }] }]);
    Object.assign(fixture.manifest.references, { newsItems: 2, images: 2, originalPaths: 2, previewPaths: 2 });
    await fixture.writeManifest();
    assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");
  });
});

test("BACKUP-COMPLETE-27 the optional legacy bucket may be explicitly retained", async () => {
  await withBackupFixture({}, async (fixture) => {
    fixture.manifest.storage["bookstore-news"] = {
      objects: [], objectCount: 0, totalBytes: 0, pathsSha256: sha256("[]\n"),
    };
    await fixture.writeManifest();
    assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");
  });
});

test("BACKUP-COMPLETE-28 an empty marker table cannot certify the optional schema bundle", async () => {
  await withBackupFixture({ schema: "modern" }, async (fixture) => {
    await fixture.writeTable("app_schema_versions", []);
    await expectFail(fixture);
  });
});

test("BACKUP-COMPLETE-29 historical workspace foundation markers remain supported", async () => {
  await withBackupFixture({ schema: "modern" }, async (fixture) => {
    const rows = structuredClone(fixture.rows.app_schema_versions);
    rows[0].version = 202609070001;
    await fixture.writeTable("app_schema_versions", rows);
    await fixture.writeManifest();
    assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");
  });
});
