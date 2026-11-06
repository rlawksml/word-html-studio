import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  BACKUP_FORMAT_VERSION,
  assertSafeBackupOutput,
  canonicalJson,
  projectFingerprint,
  sha256,
} from "./backup-utils.mjs";
import { readSupabaseSchemaCapabilities, tableSpecsForBackup } from "./supabase-schema.mjs";
import { createBackupWriter } from "./backup-writer-client.mjs";
import { assertBackupSource, captureStableBackupSource, readStorageInventory } from "./backup-source-guard.mjs";
import { inspectBackupContents, inspectBackupManifest } from "./backup-manifest-policy.mjs";

const requestedOutput = process.argv[2];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const backupDir = assertSafeBackupOutput(requestedOutput, repositoryRoot);
const supabaseUrl = assertBackupSource(process.env.SUPABASE_URL,
  process.env.BACKUP_EXPECTED_SOURCE_PROJECT_REF, process.env.BACKUP_CONFIRM_IDLE_WINDOW);
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseKey) throw new Error("SUPABASE_SECRET_KEY is required");

// Initialization must finish before even constructing the cloud client. The
// child only writes below its new root inode and never receives credentials.
const writer = await createBackupWriter({ repositoryRoot, destination: backupDir });
try {
  let client;
  try {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  } catch { throw new Error("BACKUP_SOURCE_CLIENT_FAILED"); }
  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    mode: "read-only-export",
    sourceProjectFingerprint: projectFingerprint(supabaseUrl),
    sourceCode: {
      tag: process.env.BACKUP_SOURCE_TAG || "",
      commit: process.env.BACKUP_SOURCE_COMMIT || "",
    },
    database: {},
    storage: {},
    references: {},
    migrations: [],
  };

  async function selectAll(table, orderColumns) {
    const rows = [];
    const pageSize = 500;
    const seen = new Set();
    for (let from = 0; ; from += pageSize) {
      let result;
      try {
        let query = client.from(table).select("*");
        for (const orderColumn of orderColumns) query = query.order(orderColumn);
        result = await query.range(from, from + pageSize - 1);
      } catch { throw new Error("BACKUP_DATABASE_READ_FAILED"); }
      if (result?.error || !Array.isArray(result?.data)) throw new Error("BACKUP_DATABASE_READ_FAILED");
      if (result.data.length > pageSize || rows.length + result.data.length > 100_000) {
        throw new Error("BACKUP_DATABASE_READ_LIMIT");
      }
      for (const row of result.data) {
        if (!row || typeof row !== "object" || Array.isArray(row)
          || orderColumns.some((column) => row[column] == null)) throw new Error("BACKUP_DATABASE_INVENTORY_INVALID");
        const key = JSON.stringify(orderColumns.map((column) => row[column]));
        if (seen.has(key)) throw new Error("BACKUP_DATABASE_INVENTORY_INVALID");
        seen.add(key);
        rows.push(row);
      }
      if (result.data.length < pageSize) return rows;
    }
  }

  async function archiveMigrations() {
    const migrationsDir = path.join(repositoryRoot, "apps/web/supabase/migrations");
    const migrationNames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrationNames) {
      const payload = await readFile(path.join(migrationsDir, name));
      await writer.put(`migrations/${name}`, payload);
      manifest.migrations.push({ name, bytes: payload.length, sha256: sha256(payload) });
    }
  }

  async function archiveStorage(inventory) {
    for (const bucket of inventory) {
      const objects = [];
      let totalBytes = 0;
      for (const file of bucket.objects) {
        let result;
        try {
          result = await client.storage.from(bucket.name).download(file.path);
        } catch { throw new Error("BACKUP_STORAGE_DOWNLOAD_FAILED"); }
        if (result?.error || !result?.data || typeof result.data.arrayBuffer !== "function") {
          throw new Error("BACKUP_STORAGE_DOWNLOAD_FAILED");
        }
        // SDK download has already buffered the Blob. Reject size drift before
        // making a second copy, then verify the actual bytes used by the writer.
        if (result.data.size !== file.size) throw new Error("BACKUP_STORAGE_DOWNLOAD_SIZE_MISMATCH");
        let payload;
        try { payload = Buffer.from(await result.data.arrayBuffer()); }
        catch { throw new Error("BACKUP_STORAGE_DOWNLOAD_FAILED"); }
        if (payload.length !== file.size) throw new Error("BACKUP_STORAGE_DOWNLOAD_SIZE_MISMATCH");
        await writer.put(`storage/${bucket.name}/${file.path}`, payload);
        objects.push({ path: file.path, bytes: payload.length, sha256: sha256(payload), updatedAt: file.updatedAt });
        totalBytes += payload.length;
      }
      // Preserve the original manifest path-list order and format.
      objects.sort((a, b) => a.path.localeCompare(b.path));
      manifest.storage[bucket.name] = {
        objects,
        objectCount: objects.length,
        totalBytes,
        pathsSha256: sha256(canonicalJson(objects.map((item) => item.path))),
      };
    }
  }

  const verificationTables = {};
  const tableSpecs = await captureStableBackupSource({
    readSchema: () => readSupabaseSchemaCapabilities(client),
    specsFor: (schemaCapabilities) => tableSpecsForBackup(schemaCapabilities.schemaVersionAvailable, schemaCapabilities.digestOrderAvailable),
    selectAll,
    readInventory: () => readStorageInventory(client.storage),
    async captureTable(table, rows, payload, digest) {
      await writer.put(`database/${table}.json`, payload);
      manifest.database[table] = { rows: rows.length, bytes: Buffer.byteLength(payload), sha256: digest };
      if (table === "submissions" || table === "app_schema_versions") verificationTables[table] = rows;
    },
    async captureStorage(inventory) {
      await archiveStorage(inventory);
      await archiveMigrations();
    },
  });

  const news = verificationTables.submissions.flatMap((row) => Array.isArray(row.news) ? row.news : []);
  const images = news.flatMap((item) => Array.isArray(item.images) ? item.images : []);
  const originalPaths = images.map((image) => image.originalPath).filter(Boolean).sort();
  const previewPaths = images.map((image) => image.previewPath).filter(Boolean).sort();
  const originalObjects = new Set((manifest.storage["bookstore-news-originals"]?.objects || []).map((item) => item.path));
  const previewObjects = new Set((manifest.storage["bookstore-news-previews"]?.objects || []).map((item) => item.path));
  manifest.references = {
    newsItems: news.length,
    images: images.length,
    originalPaths: originalPaths.length,
    uniqueOriginalPaths: new Set(originalPaths).size,
    previewPaths: previewPaths.length,
    uniquePreviewPaths: new Set(previewPaths).size,
    missingOriginalObjects: originalPaths.filter((item) => !originalObjects.has(item)),
    missingPreviewObjects: previewPaths.filter((item) => !previewObjects.has(item)),
    unreferencedOriginalObjects: [...originalObjects].filter((item) => !originalPaths.includes(item)).sort(),
    unreferencedPreviewObjects: [...previewObjects].filter((item) => !previewPaths.includes(item)).sort(),
  };

  manifest.completedAt = new Date().toISOString();
  if (inspectBackupManifest(manifest, BACKUP_FORMAT_VERSION).length) throw new Error("BACKUP_MANIFEST_INVENTORY_INVALID");
  const checked = inspectBackupContents(manifest, verificationTables);
  if (checked.failures.length) throw new Error("BACKUP_REFERENCES_OR_SCHEMA_INVALID");
  const manifestPayload = canonicalJson(manifest);
  await writer.put("manifest.json", manifestPayload);
  await writer.put("README.txt", [
    "Bookstore News Studio Supabase backup",
    "",
    "This export used Database SELECT and Storage list/download operations only.",
    "Before/after consistency checks are not an atomic database/storage snapshot.",
    "Never restore it into its source project. Use a separate staging project.",
    "Secrets and worker access codes are not included.",
    "Verify manifest.json checksums before every restore rehearsal.",
    "",
  ].join("\n"));
  await writer.finish([...tableSpecs.map(({ name }) => `database/${name}.json`), "manifest.json", "README.txt"]);

  console.log(canonicalJson({
    status: "COMPLETE",
    backupDir,
    manifestSha256: sha256(manifestPayload),
    database: Object.fromEntries(Object.entries(manifest.database).map(([name, item]) => [name, item.rows])),
    storage: Object.fromEntries(Object.entries(manifest.storage).map(([name, item]) => [name, item.objectCount])),
    references: Object.fromEntries(Object.entries(manifest.references).map(([name, value]) => [name, Array.isArray(value) ? value.length : value])),
    warnings: checked.warnings,
  }));
} finally {
  // SDK failure, cancellation and missing ACK retain partial data; close only
  // ends this owned child, never removes a directory or existing backup file.
  await writer.close();
}
