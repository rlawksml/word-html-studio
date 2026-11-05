import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const BACKUP_FORMAT_VERSION = 1;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function normalizeSupabaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function projectRefFromUrl(value) {
  const url = new URL(normalizeSupabaseUrl(value));
  const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (!match) throw new Error("SUPABASE_URL must use an official <project-ref>.supabase.co host");
  return match[1];
}

export function projectFingerprint(value) {
  return sha256(normalizeSupabaseUrl(value)).slice(0, 16);
}

export function assertSafeBackupOutput(backupDir, repositoryRoot) {
  if (!backupDir || !path.isAbsolute(backupDir)) {
    throw new Error("Backup output must be an absolute path");
  }

  const resolved = path.resolve(backupDir);
  const home = path.resolve(os.homedir());
  const repository = path.resolve(repositoryRoot);
  if (resolved === path.parse(resolved).root || resolved === home) {
    throw new Error("Refusing a broad backup output path");
  }
  if (resolved === repository || resolved.startsWith(`${repository}${path.sep}`)) {
    throw new Error("Backup output must stay outside the Git repository");
  }
  return resolved;
}

export function resolveInside(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, ...segments);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("Backup manifest contains an unsafe file path");
  }
  return resolved;
}

export function assertStagingRestoreTarget({
  appEnv,
  supabaseUrl,
  expectedProjectRef,
  confirmedProjectRef,
  sourceProjectFingerprint,
}) {
  if (appEnv !== "staging") {
    throw new Error("Restore is allowed only when APP_ENV=staging");
  }
  const normalizedUrl = normalizeSupabaseUrl(supabaseUrl);
  let parsedUrl;
  try { parsedUrl = new URL(normalizedUrl); }
  catch { throw new Error("Restore target must be an HTTPS official project root URL"); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.port
    || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash || normalizedUrl !== parsedUrl.origin) {
    throw new Error("Restore target must be an HTTPS official project root URL");
  }
  const actualProjectRef = projectRefFromUrl(parsedUrl.origin);
  // 이 두 프로젝트는 업무/보관 자료를 가진 현재 환경이며 복원 대상으로 재사용하지 않습니다.
  if (["kdigttaghqubfjsmbngl", "kriyjyyudngtibrtkylf"].includes(actualProjectRef)) {
    throw new Error("Refusing to restore into a protected project");
  }
  if (!expectedProjectRef || actualProjectRef !== expectedProjectRef) {
    throw new Error("SUPABASE_URL does not match EXPECTED_STAGING_PROJECT_REF");
  }
  if (!confirmedProjectRef || actualProjectRef !== confirmedProjectRef) {
    throw new Error("CONFIRM_STAGING_PROJECT_REF must exactly match the target project ref");
  }
  if (typeof sourceProjectFingerprint !== "string" || !/^[a-f0-9]{16}$/.test(sourceProjectFingerprint)
    || sourceProjectFingerprint.length !== 16) {
    throw new Error("A valid backup source project fingerprint is required");
  }
  const targetFingerprint = projectFingerprint(parsedUrl.origin);
  if (targetFingerprint === sourceProjectFingerprint) {
    throw new Error("Refusing to restore into the backup source project");
  }
  return { actualProjectRef, targetFingerprint };
}

export function planTableRestore({ table, currentRows, expectedRows, expectedSha256, allowResume }) {
  if (currentRows.length === 0) return { action: "insert", rows: expectedRows };
  if (!allowResume) throw new Error(`Refusing non-empty staging table: ${table}=${currentRows.length}`);
  if (currentRows.length !== expectedRows.length) {
    throw new Error(`Cannot resume partial staging table: ${table}=${currentRows.length}/${expectedRows.length}`);
  }
  if (sha256(canonicalJson(currentRows)) !== expectedSha256) {
    throw new Error(`Cannot resume changed staging table: ${table} hash mismatch`);
  }
  return { action: "skip", rows: [] };
}

export function planObjectRestore({ bucketName, expectedObjects, remotePaths, allowResume }) {
  if (remotePaths.length > 0 && !allowResume) {
    throw new Error(`Refusing non-empty staging bucket: ${bucketName}=${remotePaths.length}`);
  }
  const expectedPaths = new Set(expectedObjects.map((object) => object.path));
  const remoteSet = new Set(remotePaths);
  const extras = remotePaths.filter((objectPath) => !expectedPaths.has(objectPath));
  if (extras.length > 0) {
    throw new Error(`Cannot resume staging bucket with unexpected objects: ${bucketName}=${extras.length}`);
  }
  return {
    existing: expectedObjects.filter((object) => remoteSet.has(object.path)),
    missing: expectedObjects.filter((object) => !remoteSet.has(object.path)),
  };
}

export function summarizeSupabaseError(error) {
  if (!error) return "Unknown Supabase error";
  const parts = [error.message, error.name, error.status, error.statusCode, error.error, error.cause?.message]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(String);
  return [...new Set(parts)].join(" | ") || "Unknown Supabase error";
}

export async function verifyBackupDirectory(backupDir) {
  if (!backupDir || !path.isAbsolute(backupDir)) {
    throw new Error("Backup directory must be an absolute path");
  }
  const manifestPath = resolveInside(backupDir, "manifest.json");
  const manifestPayload = await readFile(manifestPath);
  const manifest = JSON.parse(manifestPayload);
  const failures = [];
  let verifiedFiles = 0;
  let verifiedBytes = 0;

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    failures.push(`unsupported backup format: ${manifest.formatVersion}`);
  }
  if (manifest.mode !== "read-only-export") {
    failures.push(`unexpected backup mode: ${manifest.mode}`);
  }

  for (const [table, expected] of Object.entries(manifest.database || {})) {
    const payload = await readFile(resolveInside(backupDir, "database", `${table}.json`));
    if (payload.length !== expected.bytes) failures.push(`${table}: byte size mismatch`);
    if (sha256(payload) !== expected.sha256) failures.push(`${table}: sha256 mismatch`);
    const rows = JSON.parse(payload);
    if (!Array.isArray(rows) || rows.length !== expected.rows) failures.push(`${table}: row count mismatch`);
    verifiedFiles += 1;
    verifiedBytes += payload.length;
  }

  for (const [bucket, details] of Object.entries(manifest.storage || {})) {
    for (const object of details.objects || []) {
      const payload = await readFile(resolveInside(backupDir, "storage", bucket, object.path));
      if (payload.length !== object.bytes) failures.push(`${bucket}/${object.path}: byte size mismatch`);
      if (sha256(payload) !== object.sha256) failures.push(`${bucket}/${object.path}: sha256 mismatch`);
      verifiedFiles += 1;
      verifiedBytes += payload.length;
    }
  }

  for (const migration of manifest.migrations || []) {
    const payload = await readFile(resolveInside(backupDir, "migrations", migration.name));
    if (payload.length !== migration.bytes) failures.push(`${migration.name}: byte size mismatch`);
    if (sha256(payload) !== migration.sha256) failures.push(`${migration.name}: sha256 mismatch`);
    verifiedFiles += 1;
    verifiedBytes += payload.length;
  }

  const incompleteExists = await stat(resolveInside(backupDir, "INCOMPLETE"))
    .then(() => true)
    .catch((error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
  if (incompleteExists) failures.push("INCOMPLETE marker exists");

  for (const key of [
    "missingOriginalObjects",
    "missingPreviewObjects",
    "unreferencedOriginalObjects",
    "unreferencedPreviewObjects",
  ]) {
    if ((manifest.references?.[key] || []).length > 0) failures.push(`reference check failed: ${key}`);
  }

  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    manifest,
    manifestSha256: sha256(manifestPayload),
    verifiedFiles,
    verifiedBytes,
    failures,
  };
}
