import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeBackupOutput,
  assertStagingRestoreTarget,
  canonicalJson,
  planObjectRestore,
  planTableRestore,
  projectFingerprint,
  sha256,
  summarizeSupabaseError,
  verifyBackupDirectory,
} from "../scripts/backup-utils.mjs";

test("restore guard rejects production-like and mismatched targets", () => {
  const stagingUrl = "https://staging-ref.supabase.co";
  assert.throws(() => assertStagingRestoreTarget({
    appEnv: "production", supabaseUrl: stagingUrl, expectedProjectRef: "staging-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: "source",
  }), /APP_ENV=staging/);
  assert.throws(() => assertStagingRestoreTarget({
    appEnv: "staging", supabaseUrl: stagingUrl, expectedProjectRef: "another-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: "source",
  }), /EXPECTED_STAGING_PROJECT_REF/);
  assert.throws(() => assertStagingRestoreTarget({
    appEnv: "staging", supabaseUrl: stagingUrl, expectedProjectRef: "staging-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: projectFingerprint(stagingUrl),
  }), /backup source project/);
  assert.equal(assertStagingRestoreTarget({
    appEnv: "staging", supabaseUrl: stagingUrl, expectedProjectRef: "staging-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: "different-source",
  }).actualProjectRef, "staging-ref");
});

test("backup output must be outside the repository", () => {
  assert.throws(() => assertSafeBackupOutput("relative", "/tmp/repository"), /absolute/);
  assert.throws(() => assertSafeBackupOutput("/tmp/repository/backups/run", "/tmp/repository"), /outside/);
  assert.equal(assertSafeBackupOutput("/tmp/bookstore-backups/run", "/tmp/repository"), "/tmp/bookstore-backups/run");
});

test("resume accepts only exact table copies and inserts empty tables", () => {
  const expectedRows = [{ id: 1, name: "책방" }];
  const expectedSha256 = sha256(canonicalJson(expectedRows));
  assert.equal(planTableRestore({
    table: "bookstores", currentRows: [], expectedRows, expectedSha256, allowResume: false,
  }).action, "insert");
  assert.equal(planTableRestore({
    table: "bookstores", currentRows: expectedRows, expectedRows, expectedSha256, allowResume: true,
  }).action, "skip");
  assert.throws(() => planTableRestore({
    table: "bookstores", currentRows: expectedRows, expectedRows, expectedSha256, allowResume: false,
  }), /non-empty staging table/);
  assert.throws(() => planTableRestore({
    table: "bookstores", currentRows: [{ id: 1, name: "변경됨" }], expectedRows, expectedSha256, allowResume: true,
  }), /hash mismatch/);
});

test("resume uploads only missing objects and rejects unexpected paths", () => {
  const expectedObjects = [{ path: "a.jpg" }, { path: "b.jpg" }];
  const plan = planObjectRestore({
    bucketName: "previews", expectedObjects, remotePaths: ["a.jpg"], allowResume: true,
  });
  assert.deepEqual(plan.existing.map((object) => object.path), ["a.jpg"]);
  assert.deepEqual(plan.missing.map((object) => object.path), ["b.jpg"]);
  assert.throws(() => planObjectRestore({
    bucketName: "previews", expectedObjects, remotePaths: ["other.jpg"], allowResume: true,
  }), /unexpected objects/);
  assert.throws(() => planObjectRestore({
    bucketName: "previews", expectedObjects, remotePaths: ["a.jpg"], allowResume: false,
  }), /non-empty staging bucket/);
});

test("Supabase errors retain useful status details", () => {
  assert.match(summarizeSupabaseError({ message: "<none>", statusCode: 503 }), /503/);
  assert.equal(summarizeSupabaseError(null), "Unknown Supabase error");
});

test("backup verifier detects file tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bookstore-backup-test-"));
  try {
    await mkdir(path.join(root, "database"));
    const rows = canonicalJson([{ id: 1, name: "테스트 책방" }]);
    await writeFile(path.join(root, "database", "bookstores.json"), rows);
    const manifest = {
      formatVersion: 1,
      mode: "read-only-export",
      database: { bookstores: { rows: 1, bytes: Buffer.byteLength(rows), sha256: sha256(rows) } },
      storage: {},
      references: {
        missingOriginalObjects: [], missingPreviewObjects: [],
        unreferencedOriginalObjects: [], unreferencedPreviewObjects: [],
      },
    };
    await writeFile(path.join(root, "manifest.json"), canonicalJson(manifest));
    assert.equal((await verifyBackupDirectory(root)).status, "PASS");

    await writeFile(path.join(root, "database", "bookstores.json"), "[]\n");
    const result = await verifyBackupDirectory(root);
    assert.equal(result.status, "FAIL");
    assert.ok(result.failures.some((failure) => failure.includes("sha256 mismatch")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
