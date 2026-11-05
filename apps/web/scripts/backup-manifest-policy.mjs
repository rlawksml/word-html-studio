// A backup's file hashes prove integrity only for listed files. This pure
// contract also requires complete supported inventories and recomputes photo
// references from verified DB payloads. It never rewrites or deletes payloads.
import { createHash } from "node:crypto";
import {
  DIGEST_ORDER_SCHEMA_COMPONENT, DIGEST_ORDER_SCHEMA_VERSION, tableSpecsForRestore,
} from "./supabase-schema.mjs";

const ORIGINAL_BUCKET = "bookstore-news-originals";
const PREVIEW_BUCKET = "bookstore-news-previews";
const BUCKETS = new Set(["bookstore-news", ORIGINAL_BUCKET, PREVIEW_BUCKET]);
const REFERENCE_COUNTS = [
  "newsItems", "images", "originalPaths", "uniqueOriginalPaths", "previewPaths", "uniquePreviewPaths",
];
const REFERENCE_LISTS = [
  "missingOriginalObjects", "missingPreviewObjects", "unreferencedOriginalObjects", "unreferencedPreviewObjects",
];
const own = (value, key) => Object.hasOwn(value, key);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
// Same canonical path-list representation used by the format-v1 exporter.
const jsonDigest = (value) => createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");

function relativeFile(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && !/[\\\u0000-\u001f\u007f]/.test(value) && !/^[A-Za-z]:/.test(value)
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function timestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) return false;
  const [, y, m, d, h, min, sec, zone, zh, zm] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59
    && (zone === "Z" || (Number(zh) <= 23 && Number(zm) <= 59)) && Number.isFinite(Date.parse(value));
}

function fileDescriptor(value) {
  return record(value) && count(value.bytes) && hash(value.sha256);
}

function validReferenceDeclaration(value) {
  return record(value) && REFERENCE_COUNTS.every((key) => own(value, key) && count(value[key]))
    && REFERENCE_LISTS.every((key) => own(value, key) && Array.isArray(value[key])
      && value[key].every(relativeFile));
}

// All returned diagnostics are fixed codes, never input paths, row contents,
// unknown field names, cloud URLs, or exception messages.
export function inspectBackupManifest(manifest, expectedFormatVersion) {
  const failures = [];
  if (!record(manifest)) return ["BACKUP_MANIFEST_INVALID"];
  if (manifest.formatVersion !== expectedFormatVersion) failures.push("BACKUP_FORMAT_UNSUPPORTED");
  if (manifest.mode !== "read-only-export") failures.push("BACKUP_MODE_INVALID");
  if (!timestamp(manifest.createdAt) || !timestamp(manifest.completedAt)
    || Date.parse(manifest.completedAt) < Date.parse(manifest.createdAt)) failures.push("BACKUP_COMPLETION_INVALID");
  if (typeof manifest.sourceProjectFingerprint !== "string"
    || !/^[a-f0-9]{16}$/.test(manifest.sourceProjectFingerprint)
    || manifest.sourceProjectFingerprint.length !== 16) failures.push("BACKUP_SOURCE_FINGERPRINT_INVALID");

  try { tableSpecsForRestore(manifest.database); }
  catch { failures.push("BACKUP_TABLE_INVENTORY_INVALID"); }
  if (record(manifest.database)) {
    for (const descriptor of Object.values(manifest.database)) {
      if (!fileDescriptor(descriptor) || !count(descriptor.rows)) failures.push("BACKUP_TABLE_DESCRIPTOR_INVALID");
    }
  }

  if (!record(manifest.storage) || !own(manifest.storage, ORIGINAL_BUCKET)
    || !own(manifest.storage, PREVIEW_BUCKET)) failures.push("BACKUP_BUCKET_INVENTORY_INCOMPLETE");
  if (record(manifest.storage)) {
    for (const [bucket, descriptor] of Object.entries(manifest.storage)) {
      if (!BUCKETS.has(bucket)) failures.push("BACKUP_BUCKET_UNSUPPORTED");
      if (!record(descriptor) || !Array.isArray(descriptor.objects)
        || !count(descriptor.objectCount) || !count(descriptor.totalBytes) || !hash(descriptor.pathsSha256)) {
        failures.push("BACKUP_BUCKET_DESCRIPTOR_INVALID");
        continue;
      }
      const paths = [], seen = new Set();
      let totalBytes = 0;
      for (const object of descriptor.objects) {
        if (!fileDescriptor(object) || !relativeFile(object.path)) {
          failures.push("BACKUP_OBJECT_DESCRIPTOR_INVALID");
          continue;
        }
        if (seen.has(object.path)) failures.push("BACKUP_OBJECT_PATH_DUPLICATED");
        seen.add(object.path);
        paths.push(object.path);
        totalBytes += object.bytes;
      }
      if (descriptor.objectCount !== descriptor.objects.length || !Number.isSafeInteger(totalBytes)
        || descriptor.totalBytes !== totalBytes || descriptor.pathsSha256 !== jsonDigest(paths)) {
        failures.push("BACKUP_BUCKET_SUMMARY_MISMATCH");
      }
    }
  }
  if (!Array.isArray(manifest.migrations)) failures.push("BACKUP_MIGRATION_INVENTORY_INVALID");
  else {
    const names = new Set();
    for (const migration of manifest.migrations) {
      if (!fileDescriptor(migration) || !relativeFile(migration.name) || migration.name.includes("/")
        || !migration.name.endsWith(".sql") || names.has(migration.name)) {
        failures.push("BACKUP_MIGRATION_DESCRIPTOR_INVALID");
        continue;
      }
      names.add(migration.name);
    }
  }
  if (!validReferenceDeclaration(manifest.references)) failures.push("BACKUP_REFERENCE_DECLARATION_INVALID");
  return [...new Set(failures)];
}

function inspectSchemaInventory(manifest, tables) {
  const hasMarkers = own(manifest.database, "app_schema_versions");
  if (!hasMarkers) return [];
  const markers = tables.app_schema_versions;
  if (!Array.isArray(markers) || markers.length === 0) return ["BACKUP_SCHEMA_MARKERS_INVALID"];
  const versions = new Map();
  for (const marker of markers) {
    if (!record(marker) || !["workspace", DIGEST_ORDER_SCHEMA_COMPONENT].includes(marker.component)
      || !Number.isSafeInteger(marker.version) || !timestamp(marker.applied_at) || versions.has(marker.component)) {
      return ["BACKUP_SCHEMA_MARKERS_INVALID"];
    }
    versions.set(marker.component, marker.version);
  }
  if (![202609070001, 202609070002].includes(versions.get("workspace"))) return ["BACKUP_SCHEMA_VERSION_UNSUPPORTED"];
  const digestVersion = versions.get(DIGEST_ORDER_SCHEMA_COMPONENT);
  const hasDigestTable = own(manifest.database, "monthly_digest_orders");
  if ((digestVersion !== undefined) !== hasDigestTable
    || (hasDigestTable && (digestVersion !== DIGEST_ORDER_SCHEMA_VERSION || versions.get("workspace") !== 202609070002))) {
    return ["BACKUP_DIGEST_CAPABILITY_MISMATCH"];
  }
  return [];
}

function photoReferences(submissions, storage) {
  const news = [], images = [];
  for (const row of submissions) {
    if (!record(row) || !Array.isArray(row.news)) return null;
    for (const item of row.news) {
      if (!record(item) || (own(item, "images") && !Array.isArray(item.images))) return null;
      news.push(item);
      for (const image of item.images || []) {
        if (!record(image)) return null;
        images.push(image);
      }
    }
  }
  const paths = (field) => {
    const values = [];
    for (const image of images) {
      const value = image[field];
      if (value === undefined || value === null || value === "") continue;
      if (!relativeFile(value)) return null;
      values.push(value);
    }
    return values.sort();
  };
  const originals = paths("originalPath"), previews = paths("previewPath");
  if (originals === null || previews === null) return null;
  const originalObjects = new Set(storage[ORIGINAL_BUCKET].objects.map((object) => object.path));
  const previewObjects = new Set(storage[PREVIEW_BUCKET].objects.map((object) => object.path));
  const originalSet = new Set(originals), previewSet = new Set(previews);
  return {
    newsItems: news.length, images: images.length,
    originalPaths: originals.length, uniqueOriginalPaths: originalSet.size,
    previewPaths: previews.length, uniquePreviewPaths: previewSet.size,
    missingOriginalObjects: originals.filter((item) => !originalObjects.has(item)),
    missingPreviewObjects: previews.filter((item) => !previewObjects.has(item)),
    unreferencedOriginalObjects: [...originalObjects].filter((item) => !originalSet.has(item)).sort(),
    unreferencedPreviewObjects: [...previewObjects].filter((item) => !previewSet.has(item)).sort(),
  };
}

// Called only after structural validation and file hash checks. Unknown raw
// row fields are inspected neither for removal nor for normalization.
export function inspectBackupContents(manifest, tables) {
  const failures = inspectSchemaInventory(manifest, tables);
  if (!Array.isArray(tables.submissions)) return [...failures, "BACKUP_SUBMISSIONS_UNVERIFIED"];
  const recomputed = photoReferences(tables.submissions, manifest.storage);
  if (recomputed === null) return [...failures, "BACKUP_PHOTO_REFERENCES_INVALID"];
  for (const key of [...REFERENCE_COUNTS, ...REFERENCE_LISTS]) {
    if (JSON.stringify(manifest.references[key]) !== JSON.stringify(recomputed[key])) {
      failures.push("BACKUP_REFERENCE_SUMMARY_MISMATCH");
    }
  }
  if (recomputed.missingOriginalObjects.length || recomputed.missingPreviewObjects.length) {
    failures.push("BACKUP_REFERENCED_PHOTO_MISSING");
  }
  // #94 must explicitly decide how retained unreferenced objects are reported.
  // Until then keep the existing blocking policy; never delete to make it pass.
  if (recomputed.unreferencedOriginalObjects.length || recomputed.unreferencedPreviewObjects.length) {
    failures.push("BACKUP_UNREFERENCED_PHOTOS_PRESENT");
  }
  return [...new Set(failures)];
}
