import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  assertStagingRestoreTarget,
  canonicalJson,
  planObjectRestore,
  planTableRestore,
  resolveInside,
  sha256,
  summarizeSupabaseError,
  verifyBackupDirectory,
} from "./backup-utils.mjs";

const backupDir = process.argv[2];
const execute = process.argv.includes("--execute");
const resume = process.argv.includes("--resume");
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

async function selectAll(table, orderColumn) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await client.from(table).select("*").order(orderColumn).range(from, from + pageSize - 1);
    if (result.error) throw new Error(`Restore verification failed for ${table}: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) return rows;
  }
}

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

async function listBucketObjects(bucketName, prefix = "") {
  const paths = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.storage.from(bucketName).list(prefix, { limit: pageSize, offset });
    if (result.error) throw new Error(`Cannot inspect staging bucket ${bucketName}: ${result.error.message}`);
    const entries = result.data || [];
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) paths.push(...await listBucketObjects(bucketName, objectPath));
      else paths.push(objectPath);
    }
    if (entries.length < pageSize) return paths;
  }
}

const tablePlans = {};
for (const table of tableOrder) {
  const currentRows = existingRows[table] > 0 ? await selectAll(table, orderColumns[table]) : [];
  tablePlans[table] = planTableRestore({
    table,
    currentRows,
    expectedRows: tableRows[table],
    expectedSha256: verification.manifest.database[table].sha256,
    allowResume: resume,
  });
}

const objectPlans = {};
for (const [bucketName, details] of Object.entries(verification.manifest.storage || {})) {
  objectPlans[bucketName] = planObjectRestore({
    bucketName,
    expectedObjects: details.objects || [],
    remotePaths: await listBucketObjects(bucketName),
    allowResume: resume,
  });
}

async function downloadPayload(bucketName, objectPath, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await client.storage.from(bucketName).download(objectPath);
    if (!result.error) return Buffer.from(await result.data.arrayBuffer());
    lastError = result.error;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 5000)));
  }
  throw new Error(`Download failed for ${bucketName}/${objectPath}: ${summarizeSupabaseError(lastError)}`);
}

for (const [bucketName, plan] of Object.entries(objectPlans)) {
  for (const object of plan.existing) {
    const payload = await downloadPayload(bucketName, object.path);
    if (payload.length !== object.bytes || sha256(payload) !== object.sha256) {
      throw new Error(`Cannot resume changed staging object: ${bucketName}/${object.path}`);
    }
  }
}

if (!execute) {
  console.log(canonicalJson({
    status: resume ? "RESUME_DRY_RUN_PASS" : "DRY_RUN_PASS",
    targetProjectRef: target.actualProjectRef,
    targetFingerprint: target.targetFingerprint,
    sourceFingerprint: verification.manifest.sourceProjectFingerprint,
    existingRows,
    backupRows: Object.fromEntries(tableOrder.map((table) => [table, tableRows[table].length])),
    existingObjects: Object.fromEntries(Object.entries(objectPlans).map(([name, plan]) => [name, plan.existing.length])),
    missingObjects: Object.fromEntries(Object.entries(objectPlans).map(([name, plan]) => [name, plan.missing.length])),
    next: resume
      ? "Re-run with --execute --resume to upload only verified missing staging objects."
      : "Re-run with --execute only after confirming this is an empty staging project.",
  }));
  process.exit(0);
}

for (const table of tableOrder) {
  const rows = tablePlans[table].rows;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const result = await client.from(table).insert(rows.slice(offset, offset + 100));
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

async function uploadMissingObject(bucketName, object, payload, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await client.storage.from(bucketName).upload(object.path, payload, {
      cacheControl: bucketName === "bookstore-news-previews" ? "300" : "3600",
      contentType: contentTypeFor(object.path),
      upsert: false,
    });
    if (!result.error) return;
    lastError = result.error;

    const existing = await client.storage.from(bucketName).download(object.path);
    if (!existing.error) {
      const existingPayload = Buffer.from(await existing.data.arrayBuffer());
      if (existingPayload.length === object.bytes && sha256(existingPayload) === object.sha256) return;
      throw new Error(`Restore found a different existing object: ${bucketName}/${object.path}`);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(`Restore failed for ${bucketName}/${object.path}: ${summarizeSupabaseError(lastError)}`);
}

for (const [bucketName, plan] of Object.entries(objectPlans)) {
  for (const object of plan.missing) {
    const payload = await readFile(resolveInside(backupDir, "storage", bucketName, object.path));
    await uploadMissingObject(bucketName, object, payload);
  }
}

const restoredRows = {};
for (const table of tableOrder) {
  const rows = await selectAll(table, orderColumns[table]);
  const payload = canonicalJson(rows);
  restoredRows[table] = rows.length;
  if (sha256(payload) !== verification.manifest.database[table].sha256) {
    throw new Error(`Restore verification hash mismatch for ${table}`);
  }
}

let restoredObjects = 0;
for (const [bucketName, details] of Object.entries(verification.manifest.storage || {})) {
  for (const object of details.objects || []) {
    const payload = await downloadPayload(bucketName, object.path);
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
