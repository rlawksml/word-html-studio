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
  const actualProjectRef = projectRefFromUrl(supabaseUrl);
  if (!expectedProjectRef || actualProjectRef !== expectedProjectRef) {
    throw new Error("SUPABASE_URL does not match EXPECTED_STAGING_PROJECT_REF");
  }
  if (!confirmedProjectRef || actualProjectRef !== confirmedProjectRef) {
    throw new Error("CONFIRM_STAGING_PROJECT_REF must exactly match the target project ref");
  }
  const targetFingerprint = projectFingerprint(supabaseUrl);
  if (sourceProjectFingerprint && targetFingerprint === sourceProjectFingerprint) {
    throw new Error("Refusing to restore into the backup source project");
  }
  return { actualProjectRef, targetFingerprint };
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
