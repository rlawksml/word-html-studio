import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeBackupOutput,
  assertStagingRestoreTarget,
  canonicalJson,
  projectFingerprint,
  sha256,
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
