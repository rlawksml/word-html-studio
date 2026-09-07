import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  assertStagingRestoreTarget,
  canonicalJson,
  resolveInside,
  sha256,
  verifyBackupDirectory,
} from "./backup-utils.mjs";

const backupDir = process.argv[2];
const execute = process.argv.includes("--execute");
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseKey) throw new Error("SUPABASE_SECRET_KEY is required");

const verification = await verifyBackupDirectory(backupDir);
if (verification.status !== "PASS") {
  throw new Error(`Backup verification failed: ${verification.failures.join(", ")}`);
}
const target = assertStagingRestoreTarget({
  appEnv: process.env.APP_ENV,
  supabaseUrl,
  expectedProjectRef: process.env.EXPECTED_STAGING_PROJECT_REF,
  confirmedProjectRef: process.env.CONFIRM_STAGING_PROJECT_REF,
  sourceProjectFingerprint: verification.manifest.sourceProjectFingerprint,
});

const client = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const tableOrder = ["bookstores", "submissions", "editing_leases", "improvement_requests"];
const orderColumns = { bookstores: "id", submissions: "id", editing_leases: "resource_key", improvement_requests: "id" };
const tableRows = {};
const existingRows = {};

for (const table of tableOrder) {
  const rows = JSON.parse(await readFile(resolveInside(backupDir, "database", `${table}.json`), "utf8"));
  tableRows[table] = rows;
  const result = await client.from(table).select("*", { count: "exact", head: true });
  if (result.error) throw new Error(`Staging schema check failed for ${table}: ${result.error.message}`);
  existingRows[table] = result.count || 0;
}

const bucketsResult = await client.storage.listBuckets();
if (bucketsResult.error) throw new Error(`Staging bucket check failed: ${bucketsResult.error.message}`);
const buckets = new Map((bucketsResult.data || []).map((bucket) => [bucket.name, bucket]));
for (const bucketName of Object.keys(verification.manifest.storage || {})) {
  if (!buckets.has(bucketName)) throw new Error(`Staging bucket is missing: ${bucketName}. Apply migrations first.`);
}
if (buckets.get("bookstore-news-originals")?.public !== false) {
  throw new Error("bookstore-news-originals must be private in staging");
}
if (buckets.get("bookstore-news-previews")?.public !== true) {
  throw new Error("bookstore-news-previews must be public in staging");
}

if (!execute) {
  console.log(canonicalJson({
    status: "DRY_RUN_PASS",
    targetProjectRef: target.actualProjectRef,
    targetFingerprint: target.targetFingerprint,
    sourceFingerprint: verification.manifest.sourceProjectFingerprint,
    existingRows,
    backupRows: Object.fromEntries(tableOrder.map((table) => [table, tableRows[table].length])),
    backupObjects: Object.fromEntries(Object.entries(verification.manifest.storage || {}).map(([name, details]) => [name, details.objectCount])),
    next: "Re-run with --execute only after confirming this is an empty staging project.",
  }));
  process.exit(0);
}

const nonEmptyTables = Object.entries(existingRows).filter(([, count]) => count > 0);
if (nonEmptyTables.length > 0) {
  throw new Error(`Refusing non-empty staging tables: ${nonEmptyTables.map(([name, count]) => `${name}=${count}`).join(", ")}`);
}

async function countBucketObjects(bucketName, prefix = "") {
  let count = 0;
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.storage.from(bucketName).list(prefix, { limit: pageSize, offset });
    if (result.error) throw new Error(`Cannot inspect staging bucket ${bucketName}: ${result.error.message}`);
    const entries = result.data || [];
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      count += entry.id === null ? await countBucketObjects(bucketName, objectPath) : 1;
    }
    if (entries.length < pageSize) return count;
  }
}

for (const bucketName of Object.keys(verification.manifest.storage || {})) {
  const count = await countBucketObjects(bucketName);
  if (count > 0) throw new Error(`Refusing non-empty staging bucket: ${bucketName}=${count}`);
}

for (const table of tableOrder) {
  for (let offset = 0; offset < tableRows[table].length; offset += 100) {
    const result = await client.from(table).insert(tableRows[table].slice(offset, offset + 100));
    if (result.error) throw new Error(`Restore failed for ${table}: ${result.error.message}`);
  }
}

function contentTypeFor(objectPath) {
  const extension = path.extname(objectPath).toLowerCase();
  return ({
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif",
  })[extension] || "application/octet-stream";
}

for (const [bucketName, details] of Object.entries(verification.manifest.storage || {})) {
  for (const object of details.objects || []) {
    const payload = await readFile(resolveInside(backupDir, "storage", bucketName, object.path));
    const result = await client.storage.from(bucketName).upload(object.path, payload, {
      cacheControl: bucketName === "bookstore-news-previews" ? "300" : "3600",
      contentType: contentTypeFor(object.path),
      upsert: false,
    });
    if (result.error) throw new Error(`Restore failed for ${bucketName}/${object.path}: ${result.error.message}`);
  }
}

const restoredRows = {};
for (const table of tableOrder) {
  const result = await client.from(table).select("*").order(orderColumns[table]);
  if (result.error) throw new Error(`Restore verification failed for ${table}: ${result.error.message}`);
  const payload = canonicalJson(result.data || []);
  restoredRows[table] = result.data?.length || 0;
  if (sha256(payload) !== verification.manifest.database[table].sha256) {
    throw new Error(`Restore verification hash mismatch for ${table}`);
  }
}

let restoredObjects = 0;
for (const [bucketName, details] of Object.entries(verification.manifest.storage || {})) {
  for (const object of details.objects || []) {
    const result = await client.storage.from(bucketName).download(object.path);
    if (result.error) throw new Error(`Restored object download failed for ${bucketName}/${object.path}: ${result.error.message}`);
    const payload = Buffer.from(await result.data.arrayBuffer());
    if (payload.length !== object.bytes || sha256(payload) !== object.sha256) {
      throw new Error(`Restored object hash mismatch for ${bucketName}/${object.path}`);
    }
    restoredObjects += 1;
  }
}

console.log(canonicalJson({
  status: "RESTORE_PASS",
  targetProjectRef: target.actualProjectRef,
  restoredRows,
  restoredObjects,
  manifestSha256: verification.manifestSha256,
}));
