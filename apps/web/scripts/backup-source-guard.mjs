import { canonicalJson, projectRefFromUrl, sha256 } from "./backup-utils.mjs";
import { isBackupTimestamp } from "./backup-manifest-policy.mjs";

const LEASE_ORDER = ["resource_key"];
// Conservative cushion for modest local/provider clock skew. This is not a lock.
const LEASE_GRACE_MS = 60_000;
const BUCKET_VISIBILITY = new Map([
  ["bookstore-news", false], ["bookstore-news-originals", false], ["bookstore-news-previews", true],
]);
const MAX_LIST_ENTRIES = 10_000;
const MAX_OBJECT_SEGMENTS = 14; // writer permits 16 with storage/<bucket>/ prepended
const MAX_OBJECT_BYTES = 64 * 1024 * 1024; // writer's per-file cap, checked before download
const PAGE_SIZE = 100;

export function assertBackupSource(url, expectedRef, idleWindow) {
  const normalized = typeof url === "string" ? url.trim().replace(/\/$/, "") : "";
  let parsed, actualRef;
  try {
    parsed = new URL(normalized);
    actualRef = projectRefFromUrl(parsed.origin);
  } catch { throw new Error("BACKUP_SOURCE_URL_INVALID"); }
  if (parsed.protocol !== "https:" || normalized !== parsed.origin) throw new Error("BACKUP_SOURCE_URL_INVALID");
  if (typeof expectedRef !== "string" || actualRef !== expectedRef) throw new Error("BACKUP_SOURCE_PROJECT_MISMATCH");
  if (idleWindow !== "confirmed") throw new Error("BACKUP_IDLE_WINDOW_CONFIRMATION_REQUIRED");
  return parsed.origin;
}

export function assertIdleEditingLeases(rows, now) {
  if (!Array.isArray(rows) || !Number.isFinite(now)) throw new Error("BACKUP_LEASE_STATE_INVALID");
  for (const row of rows) {
    if (!isBackupTimestamp(row?.expires_at)) throw new Error("BACKUP_LEASE_STATE_INVALID");
    if (Date.parse(row.expires_at) >= now - LEASE_GRACE_MS) throw new Error("BACKUP_ACTIVE_EDITING_LEASE");
  }
}

async function listed(operation) {
  let result;
  try { result = await operation(); }
  catch { throw new Error("BACKUP_STORAGE_LIST_FAILED"); }
  if (!result || result.error || !Array.isArray(result.data)) throw new Error("BACKUP_STORAGE_LIST_FAILED");
  return result.data;
}

function safeSegment(name) {
  return typeof name === "string" && name.length > 0 && name !== "." && name !== ".."
    && !/[\\/%?#\u0000-\u001f\u007f]/.test(name);
}

// Compare provider identity and content-change metadata, not access times:
// the downloads we perform may themselves update last_accessed_at.
export async function readStorageInventory(storage) {
  const result = await listed(() => storage.listBuckets());
  const buckets = result.filter((bucket) => typeof bucket?.name === "string"
    && (bucket.name === "bookstore-news" || bucket.name.startsWith("bookstore-news-")));
  const bucketNames = new Set(buckets.map((bucket) => bucket.name));
  if (bucketNames.size !== buckets.length || !bucketNames.has("bookstore-news-originals")
    || !bucketNames.has("bookstore-news-previews")) throw new Error("BACKUP_STORAGE_INVENTORY_INVALID");
  let entriesRead = 0;
  const inventory = [];
  for (const bucket of buckets.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!BUCKET_VISIBILITY.has(bucket.name) || bucket.id !== bucket.name
      || bucket.public !== BUCKET_VISIBILITY.get(bucket.name) || !isBackupTimestamp(bucket.updated_at)) {
      throw new Error("BACKUP_STORAGE_INVENTORY_INVALID");
    }
    const objects = [], seen = new Set();
    const client = storage.from(bucket.name);
    async function visit(segments = []) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const entries = await listed(() => client.list(segments.join("/"), {
          limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" },
        }));
        entriesRead += entries.length;
        if (entries.length > PAGE_SIZE || entriesRead > MAX_LIST_ENTRIES) throw new Error("BACKUP_STORAGE_LIST_LIMIT");
        for (const entry of entries) {
          if (!safeSegment(entry?.name) || segments.length >= MAX_OBJECT_SEGMENTS) {
            throw new Error("BACKUP_STORAGE_INVENTORY_INVALID");
          }
          const parts = [...segments, entry.name];
          const path = parts.join("/");
          // Folder prefixes and file keys are independent (a and a/b can coexist).
          const key = `${entry.id === null ? "prefix" : "file"}:${path}`;
          if (seen.has(key)) throw new Error("BACKUP_STORAGE_INVENTORY_INVALID");
          seen.add(key);
          if (entry.id === null) await visit(parts);
          else {
            const { size, eTag } = entry.metadata || {};
            if (typeof entry.id !== "string" || !entry.id || !isBackupTimestamp(entry.updated_at)
              || !isBackupTimestamp(entry.created_at) || !Number.isSafeInteger(size) || size < 0 || size > MAX_OBJECT_BYTES
              || typeof eTag !== "string" || !eTag.trim()) throw new Error("BACKUP_STORAGE_INVENTORY_INVALID");
            objects.push({ path, id: entry.id, updatedAt: entry.updated_at, createdAt: entry.created_at, size, eTag });
          }
        }
        if (entries.length < PAGE_SIZE) break;
      }
    }
    await visit();
    objects.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    inventory.push({ name: bucket.name, updatedAt: bucket.updated_at, objects });
  }
  return inventory;
}

// The exact rows written are the first-pass baseline. A second bounded read
// detects drift but cannot prove point-in-time atomicity or detect every ABA
// edit; an independently confirmed writer-free window remains required.
export async function captureStableBackupSource({
  readSchema, specsFor, selectAll, readInventory, captureTable, captureStorage, now = Date.now,
}) {
  const initialLeases = await selectAll("editing_leases", LEASE_ORDER);
  assertIdleEditingLeases(initialLeases, now());
  const schema = await readSchema();
  const tableSpecs = specsFor(schema);
  const fingerprints = new Map();
  for (const { name, orderColumns } of tableSpecs) {
    const rows = name === "editing_leases" ? initialLeases : await selectAll(name, orderColumns);
    const payload = canonicalJson(rows);
    const digest = sha256(payload);
    fingerprints.set(name, digest);
    await captureTable(name, rows, payload, digest);
  }

  const inventory = await readInventory();
  const storageDigest = sha256(canonicalJson(inventory));
  await captureStorage(inventory);

  if (canonicalJson(await readSchema()) !== canonicalJson(schema)) throw new Error("BACKUP_SOURCE_SCHEMA_DRIFT");
  for (const { name, orderColumns } of tableSpecs) {
    if (name === "editing_leases") continue;
    if (sha256(canonicalJson(await selectAll(name, orderColumns))) !== fingerprints.get(name)) {
      throw new Error("BACKUP_SOURCE_DATABASE_DRIFT");
    }
  }
  if (sha256(canonicalJson(await readInventory())) !== storageDigest) throw new Error("BACKUP_SOURCE_STORAGE_DRIFT");
  const finalLeases = await selectAll("editing_leases", LEASE_ORDER);
  assertIdleEditingLeases(finalLeases, now());
  if (sha256(canonicalJson(finalLeases)) !== fingerprints.get("editing_leases")) {
    throw new Error("BACKUP_SOURCE_DATABASE_DRIFT");
  }
  return tableSpecs;
}
