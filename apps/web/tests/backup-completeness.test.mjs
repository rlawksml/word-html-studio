import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { canonicalJson, planObjectRestore, sha256, verifyBackupDirectory } from "../scripts/backup-utils.mjs";
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

const PHOTO_BUCKETS = [ORIGINAL_BUCKET, PREVIEW_BUCKET];
const RETAINED_WARNINGS = [
  "BACKUP_UNREFERENCED_ORIGINALS_RETAINED",
  "BACKUP_UNREFERENCED_PREVIEWS_RETAINED",
];

// Prepare only this test invocation's newly owned synthetic backup. Its file
// inventories and bytes stay intact while selected DB references are removed.
async function arrangeRetainedPhotos(fixture, retainedBuckets) {
  const rows = structuredClone(fixture.rows.submissions);
  const image = rows[0].news[0].images[0];
  for (const [bucket, field] of [[ORIGINAL_BUCKET, "originalPath"], [PREVIEW_BUCKET, "previewPath"]]) {
    if (retainedBuckets.includes(bucket)) image[field] = "";
  }
  await fixture.writeTable("submissions", rows);
  Object.assign(fixture.manifest.references, {
    originalPaths: image.originalPath ? 1 : 0,
    uniqueOriginalPaths: image.originalPath ? 1 : 0,
    previewPaths: image.previewPath ? 1 : 0,
    uniquePreviewPaths: image.previewPath ? 1 : 0,
    unreferencedOriginalObjects: image.originalPath ? [] : [FIXTURE_PHOTO_PATH],
    unreferencedPreviewObjects: image.previewPath ? [] : [FIXTURE_PHOTO_PATH],
  });
  await fixture.writeManifest();
}

async function snapshotPhotoState(fixture) {
  return Promise.all(PHOTO_BUCKETS.map(async (bucket) => {
    const file = path.join(fixture.root, "storage", bucket, FIXTURE_PHOTO_PATH);
    try { return await readFile(file); }
    catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }));
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

test("BACKUP-COMPLETE-20 retained unreferenced photos pass with warnings, never an instruction to delete", async () => {
  const rejected = [];
  const cases = [
    ["original", [ORIGINAL_BUCKET], false],
    ["preview", [PREVIEW_BUCKET], false],
    ["both", PHOTO_BUCKETS, false],
    ["empty-submissions", PHOTO_BUCKETS, true],
  ];
  for (const [caseId, retainedBuckets, emptySubmissions] of cases) {
    await withBackupFixture({ images: true }, async (fixture) => {
      await arrangeRetainedPhotos(fixture, retainedBuckets);
      if (emptySubmissions) {
        // Preserve the original no-news/no-images case as well as the cases
        // above. All DB reference counts are zero; retained inventories stay.
        await fixture.writeTable("submissions", []);
        Object.assign(fixture.manifest.references, { newsItems: 0, images: 0 });
        await fixture.writeManifest();
      }
      const before = await fixture.snapshot();
      const photoFiles = PHOTO_BUCKETS.map((bucket) => path.join(fixture.root, "storage", bucket, FIXTURE_PHOTO_PATH));
      const photosBefore = await Promise.all(photoFiles.map((file) => readFile(file)));
      const result = await verifyBackupDirectory(fixture.root);
      for (const bucket of PHOTO_BUCKETS) {
        const objects = fixture.manifest.storage[bucket].objects;
        const plan = planObjectRestore({ bucketName: bucket, expectedObjects: objects, remotePaths: [], allowResume: false });
        assert.deepEqual(plan.existing, []);
        assert.deepEqual(plan.missing, objects, "restore must retain every inventoried object");
      }
      assert.deepEqual(await fixture.snapshot(), before);
      assert.deepEqual(await Promise.all(photoFiles.map((file) => readFile(file))), photosBefore);
      try {
        assert.equal(result.status, "PASS");
        assert.deepEqual(result.failures, []);
        assert.deepEqual(result.warnings, PHOTO_BUCKETS.flatMap((bucket, index) => retainedBuckets.includes(bucket) ? [RETAINED_WARNINGS[index]] : []));
      } catch {
        rejected.push(caseId);
      }
    });
  }
  assert.deepEqual(rejected, [], "every retained-photo case must pass without changing backup bytes");
});

test("BACKUP-COMPLETE-21 complete legacy backups may contain zero rows and zero photos", async () => {
  await withBackupFixture({}, async (fixture) => {
    const result = await verifyBackupDirectory(fixture.root);
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.warnings, []);
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

test("BACKUP-COMPLETE-30 invalid retained-photo backups fail and CLI summaries expose only verified warnings", async () => {
  // All matrix entries and source contracts are attempted before the final
  // assertion. Fixed case IDs preserve diagnostics without echoing source data.
  const rejected = [];
  async function check(caseId, run) {
    try { await run(); }
    catch { rejected.push(caseId); }
  }
  const invalidCases = [
    ["forged-summary", "BACKUP_REFERENCE_SUMMARY_MISMATCH", async (fixture) => {
      await arrangeRetainedPhotos(fixture, PHOTO_BUCKETS);
      fixture.manifest.references.unreferencedOriginalObjects = [];
    }],
    ["missing-retained-file", "BACKUP_STORAGE_FILE_UNREADABLE", async (fixture) => {
      await arrangeRetainedPhotos(fixture, PHOTO_BUCKETS);
      await unlink(path.join(fixture.root, "storage", ORIGINAL_BUCKET, FIXTURE_PHOTO_PATH));
    }],
    ["tampered-retained-file", "BACKUP_STORAGE_HASH_MISMATCH", async (fixture) => {
      await arrangeRetainedPhotos(fixture, PHOTO_BUCKETS);
      await writeFile(path.join(fixture.root, "storage", ORIGINAL_BUCKET, FIXTURE_PHOTO_PATH), "synthetic tampered bytes\n");
    }],
    ["missing-reference-and-retained-preview", "BACKUP_REFERENCED_PHOTO_MISSING", async (fixture) => {
      await arrangeRetainedPhotos(fixture, [PREVIEW_BUCKET]);
      fixture.clearBucketInventory(ORIGINAL_BUCKET);
      fixture.manifest.references.missingOriginalObjects = [FIXTURE_PHOTO_PATH];
    }],
  ];
  for (const [caseId, failureCode, arrange] of invalidCases) {
    await check(caseId, () => withBackupFixture({ images: true }, async (fixture) => {
      await arrange(fixture);
      await fixture.writeManifest();
      const before = await fixture.snapshot();
      const photosBefore = await snapshotPhotoState(fixture);
      let result;
      try {
        result = await verifyBackupDirectory(fixture.root);
      } finally {
        // Even the intentionally missing file must remain missing. A verifier
        // must not recreate it, repair tampering, or remove the other photo.
        assert.deepEqual(await snapshotPhotoState(fixture), photosBefore);
        assert.deepEqual(await fixture.snapshot(), before);
      }
      assert.equal(result.status, "FAIL");
      assert.ok(result.failures.includes(failureCode));
      assert.deepEqual(result.warnings, [], "failed verification must not claim verified retention");
    }));
  }
  await check("verify-cli-warning-contract", async () => {
    const source = await readFile(new URL("../scripts/supabase-backup-verify.mjs", import.meta.url), "utf8");
    assert.match(source, /warnings:\s*result\.warnings\b/);
    assert.match(source, /if \(result\.status !== "PASS"\) process\.exitCode = 1/);
  });
  await check("restore-cli-warning-contract", async () => {
    // Read the SDK-using CLI as text only. No import, execution, or cloud call.
    const source = await readFile(new URL("../scripts/supabase-restore-staging.mjs", import.meta.url), "utf8");
    const summaries = source.match(/console\.log\(canonicalJson\(\{[\s\S]*?\}\)\);/g) || [];
    assert.equal(summaries.length, 2, "dry-run and final restore summaries are both required");
    for (const summary of summaries) assert.match(summary, /warnings:\s*verification\.warnings\b/);
  });
  assert.deepEqual(rejected, [], "all invalid cases and CLI warning contracts must hold");
});
