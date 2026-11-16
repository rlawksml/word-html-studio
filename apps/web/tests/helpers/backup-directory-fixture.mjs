// Synthetic, dependency-free backup data. This helper never loads environment
// files, cloud clients, live database rows, or existing backup directories.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalJson, sha256 } from "../../scripts/backup-utils.mjs";

export const CORE_BACKUP_TABLES = [
  "bookstores", "submissions", "editing_leases", "improvement_requests",
];
export const ORIGINAL_BUCKET = "bookstore-news-originals";
export const PREVIEW_BUCKET = "bookstore-news-previews";
export const FIXTURE_PHOTO_PATH = "qa-book/qa-news/photo.jpg";

function emptyReferences() {
  return {
    newsItems: 0, images: 0, originalPaths: 0, uniqueOriginalPaths: 0,
    previewPaths: 0, uniquePreviewPaths: 0,
    missingOriginalObjects: [], missingPreviewObjects: [],
    unreferencedOriginalObjects: [], unreferencedPreviewObjects: [],
  };
}

function objectSummary(objects) {
  return {
    objects,
    objectCount: objects.length,
    totalBytes: objects.reduce((sum, object) => sum + object.bytes, 0),
    pathsSha256: sha256(canonicalJson(objects.map((object) => object.path))),
  };
}

// Every created file is beneath this invocation's newly owned temporary root.
// Cleanup receives that exact root, never a caller-controlled or cloud path.
export async function withBackupFixture(options, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bookstore-completeness-fixture-"));
  const rows = Object.fromEntries(CORE_BACKUP_TABLES.map((table) => [table, []]));
  if (options.schema === "modern" || options.schema === "digest") {
    rows.app_schema_versions = [{
      component: "workspace", version: 202609070002,
      applied_at: "2026-11-05T00:00:00.000Z",
    }];
    rows.news_schedule_ranges = [];
  }
  if (options.schema === "digest") {
    rows.app_schema_versions.push({
      component: "digest_order", version: 202611040001,
      applied_at: "2026-11-05T00:00:00.000Z",
    });
    rows.monthly_digest_orders = [];
  }
  const manifest = {
    formatVersion: 1, mode: "read-only-export",
    createdAt: "2026-11-05T00:00:00.000Z",
    completedAt: "2026-11-05T00:00:01.000Z",
    sourceProjectFingerprint: "1".repeat(16),
    sourceCode: { tag: "synthetic-only", commit: "a".repeat(40) },
    database: {},
    storage: {
      [ORIGINAL_BUCKET]: objectSummary([]),
      [PREVIEW_BUCKET]: objectSummary([]),
    },
    references: emptyReferences(),
    migrations: [],
  };
  const fixture = {
    root, manifest, rows,
    async writeTable(table, value) {
      if (!Object.hasOwn(rows, table)) throw new Error("FIXTURE_TABLE_NOT_OWNED");
      rows[table] = value;
      const payload = canonicalJson(value);
      await writeFile(path.join(root, "database", `${table}.json`), payload);
      manifest.database[table] = {
        rows: value.length, bytes: Buffer.byteLength(payload), sha256: sha256(payload),
      };
    },
    async writeManifest() {
      await writeFile(path.join(root, "manifest.json"), canonicalJson(manifest));
    },
    async snapshot() {
      const snapshot = {};
      for (const table of Object.keys(rows)) {
        snapshot[table] = await readFile(path.join(root, "database", `${table}.json`), "utf8");
      }
      snapshot.manifest = await readFile(path.join(root, "manifest.json"), "utf8");
      return snapshot;
    },
    clearBucketInventory(bucket) {
      if (![ORIGINAL_BUCKET, PREVIEW_BUCKET].includes(bucket)) throw new Error("FIXTURE_BUCKET_NOT_OWNED");
      manifest.storage[bucket] = objectSummary([]);
    },
  };
  try {
    await mkdir(path.join(root, "database"));
    for (const [table, value] of Object.entries(rows)) await fixture.writeTable(table, value);
    if (options.images) {
      await fixture.writeTable("submissions", [{ id: 1, news: [{
        id: 2, title: "QA only", images: [{
          id: 3, originalPath: FIXTURE_PHOTO_PATH, previewPath: FIXTURE_PHOTO_PATH,
          futureImage: { preserved: true },
        }], futureNews: { preserved: true },
      }], futureSubmission: { preserved: true } }]);
      for (const bucket of [ORIGINAL_BUCKET, PREVIEW_BUCKET]) {
        const payload = Buffer.from("synthetic image bytes, not a user photo");
        const destination = path.join(root, "storage", bucket, FIXTURE_PHOTO_PATH);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, payload);
        manifest.storage[bucket] = objectSummary([{
          path: FIXTURE_PHOTO_PATH, bytes: payload.length, sha256: sha256(payload),
          updatedAt: "2026-11-05T00:00:00.000Z",
        }]);
      }
      manifest.references = {
        ...emptyReferences(), newsItems: 1, images: 1,
        originalPaths: 1, uniqueOriginalPaths: 1, previewPaths: 1, uniquePreviewPaths: 1,
      };
    }
    await fixture.writeManifest();
    return await run(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
