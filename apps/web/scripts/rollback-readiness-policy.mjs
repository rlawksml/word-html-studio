// Preparation only. These checks validate supplied declarations, never live evidence.
export const PRODUCTION_SITES_PROJECT_ID = "appgprj_6a5dbe2598fc8191a1c25c37e759c6ae";
export const PRODUCTION_SUPABASE_PROJECT_REF = "kdigttaghqubfjsmbngl";
export const MAX_MANIFEST_BYTES = 32 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?$/;
// Sites saved versions use a canonical composite ID, not a URL or bare tag.
// The project prefix is part of the immutable identity and must be Production.
const SITES_VERSION_ID = new RegExp(`^${PRODUCTION_SITES_PROJECT_ID}~appgver_[a-f0-9]{32}$`);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY = 24 * 60 * 60 * 1000;

const KEYS = {
  root: ["formatVersion", "purpose", "mode", "target", "appAction", "databaseAction", "storageAction", "migrationAction", "productionBaseline", "releaseCandidate", "rollbackArtifact", "latestBackup", "environmentPreservation", "compatibility", "readOnlySmoke"],
  target: ["sitesProjectId", "supabaseProjectRef"],
  productionBaseline: ["version", "commit", "immutableVersionId", "schemaVersion", "deployedAt", "observedAt", "evidenceSha256"],
  releaseCandidate: ["commit", "schemaVersion"],
  rollbackArtifact: ["provider", "projectId", "immutableVersionId", "version", "commit", "sha256", "capturedAt"],
  latestBackup: ["capturedAt", "verifiedAt", "manifestSha256", "databaseAndStorageVerified", "baselineCommit", "supabaseProjectRef"],
  environmentPreservation: ["verifiedAt", "evidenceSha256", "projectId", "supabaseProjectRef", "keepCurrentBindings", "credentialsUnchanged"],
  compatibility: ["verifiedAt", "evidenceSha256", "artifactCommit", "artifactVersionId", "artifactSha256", "releaseCandidateCommit", "schemaVersion", "unknownJsonFieldsPreserved", "scheduleRangesPreserved", "storageReferencesPreserved"],
  readOnlySmoke: ["verifiedAt", "evidenceSha256", "artifactCommit", "artifactVersionId", "artifactSha256", "schemaVersion", "readOnly", "passed"],
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const missing = (value) => value === undefined || value === null || value === "";

export function parsePrepareArguments(args) {
  // No flags, shell fragments, URLs, env files, or implicit/default input files.
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string") {
    throw new Error("ONE_EXPLICIT_LOCAL_JSON_REQUIRED");
  }
  const file = args[0];
  if (!/^(?:\/|\.\/)[a-zA-Z0-9_./ -]+\.json$/.test(file)
      || file.trim() !== file || /[\r\n\t]/.test(file)
      || file.includes("..") || file.includes("//")
      || /(?:^|\/)\.env(?:\.|\/|$)/i.test(file)
      || /(?:^|\/)(?:[^/]*[-_.])?(?:credentials?|secrets?|keys?)(?:[-_.]|$)/i.test(file)) {
    throw new Error("UNSAFE_MANIFEST_PATH");
  }
  return file;
}

export function parseRollbackManifest(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) {
    throw new Error("MANIFEST_SIZE_INVALID");
  }
  try {
    return JSON.parse(text);
  } catch {
    // Never include JSON parser excerpts, which could contain supplied secrets.
    throw new Error("MANIFEST_JSON_INVALID");
  }
}

export function evaluateRollbackReadiness(manifest, { asOf } = {}) {
  const blockers = new Set();
  const violations = new Set();
  const block = (code) => blockers.add(code);
  const reject = (code) => violations.add(code);
  const now = typeof asOf === "string" && ISO.test(asOf) ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(now) || new Date(now).toISOString() !== asOf) reject("AS_OF_INVALID");

  function object(value, section) {
    if (missing(value)) { block(`${section.toUpperCase()}_MISSING`); return {}; }
    if (!isObject(value)) { reject("OBJECT_REQUIRED"); return {}; }
    if (Object.keys(value).some((key) => !KEYS[section].includes(key))) reject("UNKNOWN_FIELD");
    return value;
  }
  function required(value, pattern, code) {
    if (missing(value)) block(`${code}_MISSING`);
    else if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value) || !pattern.test(value)) reject(`${code}_INVALID`);
  }
  function exact(value, expected, code) {
    if (missing(value)) block(`${code}_MISSING`);
    else if (value !== expected) reject(`${code}_INVALID`);
  }
  function attestation(value, code) {
    if (missing(value) || value === false) block(`${code}_UNCONFIRMED`);
    else if (value !== true) reject(`${code}_INVALID`);
  }
  function timestamp(value, code, fresh = true) {
    required(value, ISO, code);
    const time = typeof value === "string" ? Date.parse(value) : NaN;
    if (!missing(value) && (!Number.isFinite(time) || new Date(time).toISOString() !== value)) {
      reject(`${code}_INVALID`);
    } else if (Number.isFinite(time) && Number.isFinite(now)) {
      if (time > now + 5 * 60 * 1000) reject(`${code}_FUTURE`);
      if (fresh && now - time > DAY) block(`${code}_STALE`);
    }
    return time;
  }
  function schema(value, code) {
    if (missing(value)) block(`${code}_MISSING`);
    else if (!Number.isSafeInteger(value) || value < 1) reject(`${code}_INVALID`);
  }
  function same(left, right, code) {
    if (!missing(left) && !missing(right) && left !== right) reject(code);
  }

  const root = object(manifest, "root");
  exact(root.formatVersion, 2, "FORMAT_VERSION");
  exact(root.purpose, "pre-deployment-fallback", "PURPOSE");
  exact(root.mode, "prepare-only", "MODE");
  exact(root.appAction, "pin-immutable-artifact", "APP_ACTION");
  exact(root.databaseAction, "preserve-current", "DATABASE_ACTION");
  exact(root.storageAction, "preserve-current", "STORAGE_ACTION");
  exact(root.migrationAction, "none", "MIGRATION_ACTION");
  const target = object(root.target, "target");
  exact(target.sitesProjectId, PRODUCTION_SITES_PROJECT_ID, "PRODUCTION_SITES_PROJECT");
  exact(target.supabaseProjectRef, PRODUCTION_SUPABASE_PROJECT_REF, "PRODUCTION_SUPABASE_PROJECT");

  const baseline = object(root.productionBaseline, "productionBaseline");
  required(baseline.version, VERSION, "BASELINE_VERSION");
  required(baseline.commit, COMMIT, "BASELINE_COMMIT");
  required(baseline.immutableVersionId, SITES_VERSION_ID, "BASELINE_ARTIFACT_ID");
  required(baseline.evidenceSha256, SHA, "BASELINE_EVIDENCE_HASH");
  schema(baseline.schemaVersion, "BASELINE_SCHEMA");
  const deployedAt = timestamp(baseline.deployedAt, "BASELINE_DEPLOYED_AT", false);
  const baselineAt = timestamp(baseline.observedAt, "BASELINE_OBSERVED_AT");
  if (deployedAt > baselineAt) reject("BASELINE_OBSERVATION_PREDATES_DEPLOYMENT");

  const candidate = object(root.releaseCandidate, "releaseCandidate");
  required(candidate.commit, COMMIT, "RELEASE_CANDIDATE_COMMIT");
  schema(candidate.schemaVersion, "RELEASE_CANDIDATE_SCHEMA");
  if (!missing(candidate.commit) && candidate.commit === baseline.commit) reject("CANDIDATE_EQUALS_BASELINE_COMMIT");

  const artifact = object(root.rollbackArtifact, "rollbackArtifact");
  exact(artifact.provider, "sites", "ROLLBACK_PROVIDER");
  exact(artifact.projectId, PRODUCTION_SITES_PROJECT_ID, "ROLLBACK_PROJECT");
  required(artifact.immutableVersionId, SITES_VERSION_ID, "ROLLBACK_ARTIFACT_ID");
  required(artifact.version, VERSION, "ROLLBACK_VERSION");
  required(artifact.commit, COMMIT, "ROLLBACK_COMMIT");
  required(artifact.sha256, SHA, "ROLLBACK_ARTIFACT_HASH");
  // Before deployment, the known-current app is the fallback, not an older app.
  // capturedAt is the fresh artifact observation time, not its deployment time.
  timestamp(artifact.capturedAt, "ROLLBACK_CAPTURED_AT");
  same(artifact.immutableVersionId, baseline.immutableVersionId, "FALLBACK_BASELINE_ARTIFACT_MISMATCH");
  same(artifact.commit, baseline.commit, "FALLBACK_BASELINE_COMMIT_MISMATCH");
  same(artifact.version, baseline.version, "FALLBACK_BASELINE_VERSION_MISMATCH");

  const backup = object(root.latestBackup, "latestBackup");
  required(backup.manifestSha256, SHA, "BACKUP_MANIFEST_HASH");
  required(backup.baselineCommit, COMMIT, "BACKUP_BASELINE_COMMIT");
  same(backup.baselineCommit, baseline.commit, "BACKUP_BASELINE_MISMATCH");
  exact(backup.supabaseProjectRef, PRODUCTION_SUPABASE_PROJECT_REF, "BACKUP_PROJECT");
  attestation(backup.databaseAndStorageVerified, "BACKUP_DATABASE_STORAGE_VERIFIED");
  const backupCapturedAt = timestamp(backup.capturedAt, "BACKUP_CAPTURED_AT");
  const backupAt = timestamp(backup.verifiedAt, "BACKUP_VERIFIED_AT");
  if (backupCapturedAt < deployedAt) block("BACKUP_PREDATES_BASELINE_DEPLOYMENT");
  if (backupAt < backupCapturedAt) reject("BACKUP_VERIFICATION_PREDATES_CAPTURE");

  const env = object(root.environmentPreservation, "environmentPreservation");
  required(env.evidenceSha256, SHA, "ENVIRONMENT_EVIDENCE_HASH");
  exact(env.projectId, PRODUCTION_SITES_PROJECT_ID, "ENVIRONMENT_SITES_PROJECT");
  exact(env.supabaseProjectRef, PRODUCTION_SUPABASE_PROJECT_REF, "ENVIRONMENT_SUPABASE_PROJECT");
  attestation(env.keepCurrentBindings, "ENVIRONMENT_CURRENT_BINDINGS");
  attestation(env.credentialsUnchanged, "ENVIRONMENT_CREDENTIALS_UNCHANGED");
  timestamp(env.verifiedAt, "ENVIRONMENT_VERIFIED_AT");

  const compatibility = object(root.compatibility, "compatibility");
  const smoke = object(root.readOnlySmoke, "readOnlySmoke");
  for (const [evidence, prefix] of [[compatibility, "COMPATIBILITY"], [smoke, "SMOKE"]]) {
    required(evidence.evidenceSha256, SHA, `${prefix}_EVIDENCE_HASH`);
    required(evidence.artifactCommit, COMMIT, `${prefix}_ARTIFACT_COMMIT`);
    same(evidence.artifactCommit, artifact.commit, `${prefix}_ARTIFACT_MISMATCH`);
    required(evidence.artifactVersionId, SITES_VERSION_ID, `${prefix}_ARTIFACT_ID`);
    required(evidence.artifactSha256, SHA, `${prefix}_ARTIFACT_HASH`);
    same(evidence.artifactVersionId, artifact.immutableVersionId, `${prefix}_ARTIFACT_ID_MISMATCH`);
    same(evidence.artifactSha256, artifact.sha256, `${prefix}_ARTIFACT_HASH_MISMATCH`);
    schema(evidence.schemaVersion, `${prefix}_SCHEMA`);
    if (timestamp(evidence.verifiedAt, `${prefix}_VERIFIED_AT`) < backupAt) block(`${prefix}_PREDATES_LATEST_BACKUP`);
  }
  // Health smoke describes today's Production schema. Compatibility separately
  // declares fallback behavior against the candidate's future schema/data.
  same(smoke.schemaVersion, baseline.schemaVersion, "SMOKE_SCHEMA_MISMATCH");
  same(compatibility.schemaVersion, candidate.schemaVersion, "COMPATIBILITY_SCHEMA_MISMATCH");
  required(compatibility.releaseCandidateCommit, COMMIT, "COMPATIBILITY_CANDIDATE_COMMIT");
  same(compatibility.releaseCandidateCommit, candidate.commit, "COMPATIBILITY_CANDIDATE_MISMATCH");
  attestation(compatibility.unknownJsonFieldsPreserved, "COMPATIBILITY_UNKNOWN_JSON");
  attestation(compatibility.scheduleRangesPreserved, "COMPATIBILITY_SCHEDULE_RANGES");
  attestation(compatibility.storageReferencesPreserved, "COMPATIBILITY_PHOTO_REFERENCES");
  attestation(smoke.readOnly, "SMOKE_READ_ONLY");
  attestation(smoke.passed, "SMOKE_PASSED");

  return {
    status: violations.size ? "BLOCKED" : blockers.size ? "PREPARED_WITH_BLOCKERS" : "PREPARED_DECLARED_ONLY",
    evidenceStatus: "DECLARED_NOT_VERIFIED",
    executionAvailable: false,
    deploymentAuthorized: false,
    blockers: [...blockers].sort(),
    violations: [...violations].sort(),
  };
}
