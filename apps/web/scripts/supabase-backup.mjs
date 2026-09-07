import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  BACKUP_FORMAT_VERSION,
  assertSafeBackupOutput,
  canonicalJson,
  projectFingerprint,
  resolveInside,
  sha256,
} from "./backup-utils.mjs";

const requestedOutput = process.argv[2];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const backupDir = assertSafeBackupOutput(requestedOutput, repositoryRoot);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

await stat(backupDir).then(
  () => { throw new Error(`Backup target already exists: ${backupDir}`); },
  (error) => { if (error?.code !== "ENOENT") throw error; },
);

await mkdir(backupDir, { recursive: true, mode: 0o700 });
await writeFile(resolveInside(backupDir, "INCOMPLETE"), "Backup did not finish. Do not restore it.\n", { mode: 0o600 });

const client = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
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

async function selectAll(table, orderColumn) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await client.from(table).select("*").order(orderColumn).range(from, from + pageSize - 1);
    if (result.error) throw new Error(`Database export failed for ${table}: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) return rows;
  }
}

const tableSpecs = [
  ["bookstores", "id"],
  ["submissions", "id"],
  ["editing_leases", "resource_key"],
  ["improvement_requests", "id"],
];
await mkdir(resolveInside(backupDir, "database"), { recursive: true, mode: 0o700 });
let submissions = [];
for (const [table, orderColumn] of tableSpecs) {
  const rows = await selectAll(table, orderColumn);
  const payload = canonicalJson(rows);
  await writeFile(resolveInside(backupDir, "database", `${table}.json`), payload, { mode: 0o600 });
  manifest.database[table] = { rows: rows.length, bytes: Buffer.byteLength(payload), sha256: sha256(payload) };
  if (table === "submissions") submissions = rows;
}

const migrationsDir = path.join(repositoryRoot, "apps/web/supabase/migrations");
const migrationNames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
await mkdir(resolveInside(backupDir, "migrations"), { recursive: true, mode: 0o700 });
for (const name of migrationNames) {
  const payload = await readFile(path.join(migrationsDir, name));
  await writeFile(resolveInside(backupDir, "migrations", name), payload, { mode: 0o600 });
  manifest.migrations.push({ name, bytes: payload.length, sha256: sha256(payload) });
}

async function listFiles(bucketName, prefix = "") {
  const files = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.storage.from(bucketName).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (result.error) throw new Error(`Storage listing failed for ${bucketName}/${prefix}: ${result.error.message}`);
    const entries = result.data || [];
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...await listFiles(bucketName, objectPath));
      else files.push({ path: objectPath, updatedAt: entry.updated_at || null });
    }
    if (entries.length < pageSize) return files;
  }
}

const bucketsResult = await client.storage.listBuckets();
if (bucketsResult.error) throw new Error(`Bucket listing failed: ${bucketsResult.error.message}`);
const bucketNames = (bucketsResult.data || [])
  .map((bucket) => bucket.name)
  .filter((name) => name === "bookstore-news" || name.startsWith("bookstore-news-"))
  .sort();

for (const bucketName of bucketNames) {
  const objects = [];
  let totalBytes = 0;
  for (const file of await listFiles(bucketName)) {
    const result = await client.storage.from(bucketName).download(file.path);
    if (result.error) throw new Error(`Storage download failed for ${bucketName}/${file.path}: ${result.error.message}`);
    const payload = Buffer.from(await result.data.arrayBuffer());
    const destination = resolveInside(backupDir, "storage", bucketName, file.path);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, payload, { mode: 0o600 });
    objects.push({ path: file.path, bytes: payload.length, sha256: sha256(payload), updatedAt: file.updatedAt });
    totalBytes += payload.length;
  }
  objects.sort((a, b) => a.path.localeCompare(b.path));
  manifest.storage[bucketName] = {
    objects,
    objectCount: objects.length,
    totalBytes,
    pathsSha256: sha256(canonicalJson(objects.map((item) => item.path))),
  };
}

const news = submissions.flatMap((row) => Array.isArray(row.news) ? row.news : []);
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
const manifestPayload = canonicalJson(manifest);
await writeFile(resolveInside(backupDir, "manifest.json"), manifestPayload, { mode: 0o600 });
await writeFile(resolveInside(backupDir, "README.txt"), [
  "Bookstore News Studio Supabase backup",
  "",
  "This export used Database SELECT and Storage list/download operations only.",
  "Never restore it into its source project. Use a separate staging project.",
  "Secrets and worker access codes are not included.",
  "Verify manifest.json checksums before every restore rehearsal.",
  "",
].join("\n"), { mode: 0o600 });
await unlink(resolveInside(backupDir, "INCOMPLETE"));

console.log(canonicalJson({
  status: "COMPLETE",
  backupDir,
  manifestSha256: sha256(manifestPayload),
  database: Object.fromEntries(Object.entries(manifest.database).map(([name, item]) => [name, item.rows])),
  storage: Object.fromEntries(Object.entries(manifest.storage).map(([name, item]) => [name, item.objectCount])),
  references: manifest.references,
}));
