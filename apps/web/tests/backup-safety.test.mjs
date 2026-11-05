import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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
import { withBackupFixture } from "./helpers/backup-directory-fixture.mjs";

test("restore guard rejects production-like and mismatched targets", () => {
  const stagingUrl = "https://staging-ref.supabase.co";
  assert.throws(() => assertStagingRestoreTarget({
    appEnv: "production", supabaseUrl: stagingUrl, expectedProjectRef: "staging-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: "1".repeat(16),
  }), /APP_ENV=staging/);
  assert.throws(() => assertStagingRestoreTarget({
    appEnv: "staging", supabaseUrl: stagingUrl, expectedProjectRef: "another-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: "1".repeat(16),
  }), /EXPECTED_STAGING_PROJECT_REF/);
  assert.throws(() => assertStagingRestoreTarget({
    appEnv: "staging", supabaseUrl: stagingUrl, expectedProjectRef: "staging-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: projectFingerprint(stagingUrl),
  }), /backup source project/);
  assert.equal(assertStagingRestoreTarget({
    appEnv: "staging", supabaseUrl: stagingUrl, expectedProjectRef: "staging-ref",
    confirmedProjectRef: "staging-ref", sourceProjectFingerprint: "1".repeat(16),
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
  await withBackupFixture({}, async (fixture) => {
    await fixture.writeTable("bookstores", [{ id: 1, name: "테스트 책방" }]);
    await fixture.writeManifest();
    assert.equal((await verifyBackupDirectory(fixture.root)).status, "PASS");

    await writeFile(path.join(fixture.root, "database", "bookstores.json"), "[]\n");
    const result = await verifyBackupDirectory(fixture.root);
    assert.equal(result.status, "FAIL");
    assert.ok(result.failures.includes("BACKUP_DATABASE_HASH_MISMATCH"));
  });
});
