import assert from "node:assert/strict";
import { constants } from "node:fs";
import test from "node:test";
import { main, readExplicitManifest } from "../scripts/prepare-rollback.mjs";
import {
  MAX_MANIFEST_BYTES,
  PRODUCTION_SITES_PROJECT_ID,
  PRODUCTION_SUPABASE_PROJECT_REF,
  evaluateRollbackReadiness,
  parsePrepareArguments,
  parseRollbackManifest,
} from "../scripts/rollback-readiness-policy.mjs";

const asOf = "2026-11-04T12:00:00.000Z";
const hash = "a".repeat(64);
const currentCommit = "b".repeat(40);
const rollbackCommit = currentCommit;
const candidateCommit = "c".repeat(40);
const baselineAt = "2026-11-04T10:00:00.000Z";
const verifiedAt = "2026-11-04T11:00:00.000Z";
// Format-valid sentinels, not assertions that these versions exist or are live.
const currentArtifactId = `${PRODUCTION_SITES_PROJECT_ID}~appgver_${"1".repeat(32)}`;
const rollbackArtifactId = currentArtifactId;
const otherArtifactId = `${PRODUCTION_SITES_PROJECT_ID}~appgver_${"2".repeat(32)}`;

function declaredManifest() {
  // Synthetic declarations only: no real deployment or evidence is asserted.
  return {
    formatVersion: 2,
    purpose: "pre-deployment-fallback",
    mode: "prepare-only",
    appAction: "pin-immutable-artifact",
    databaseAction: "preserve-current",
    storageAction: "preserve-current",
    migrationAction: "none",
    target: { sitesProjectId: PRODUCTION_SITES_PROJECT_ID, supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF },
    productionBaseline: { version: "1.0.1", commit: currentCommit, immutableVersionId: currentArtifactId, schemaVersion: 202607240002, deployedAt: "2026-11-01T10:00:00.000Z", observedAt: baselineAt, evidenceSha256: hash },
    releaseCandidate: { commit: candidateCommit, schemaVersion: 202609070002 },
    rollbackArtifact: { provider: "sites", projectId: PRODUCTION_SITES_PROJECT_ID, immutableVersionId: rollbackArtifactId, version: "1.0.1", commit: rollbackCommit, sha256: hash, capturedAt: verifiedAt },
    latestBackup: { capturedAt: baselineAt, verifiedAt, manifestSha256: hash, databaseAndStorageVerified: true, baselineCommit: currentCommit, supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF },
    environmentPreservation: { verifiedAt, evidenceSha256: hash, projectId: PRODUCTION_SITES_PROJECT_ID, supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF, keepCurrentBindings: true, credentialsUnchanged: true },
    compatibility: { verifiedAt, evidenceSha256: hash, artifactCommit: rollbackCommit, artifactVersionId: rollbackArtifactId, artifactSha256: hash, releaseCandidateCommit: candidateCommit, schemaVersion: 202609070002, unknownJsonFieldsPreserved: true, scheduleRangesPreserved: true, storageReferencesPreserved: true },
    readOnlySmoke: { verifiedAt, evidenceSha256: hash, artifactCommit: rollbackCommit, artifactVersionId: rollbackArtifactId, artifactSha256: hash, schemaVersion: 202607240002, readOnly: true, passed: true },
  };
}

const evaluate = (manifest) => evaluateRollbackReadiness(manifest, { asOf });

test("complete declarations pass preparation only, never authorize execution", () => {
  const result = evaluate(declaredManifest());
  assert.equal(result.status, "PREPARED_DECLARED_ONLY");
  assert.equal(result.evidenceStatus, "DECLARED_NOT_VERIFIED");
  assert.equal(result.executionAvailable, false);
  assert.equal(result.deploymentAuthorized, false);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.blockers, []);
});

test("missing evidence and placeholder template cannot look ready", () => {
  for (const section of ["productionBaseline", "releaseCandidate", "rollbackArtifact", "latestBackup", "environmentPreservation", "compatibility", "readOnlySmoke"]) {
    const manifest = declaredManifest();
    delete manifest[section];
    assert.equal(evaluate(manifest).status, "PREPARED_WITH_BLOCKERS");
  }
  assert.equal(evaluate({}).status, "PREPARED_WITH_BLOCKERS");
  assert.equal(evaluate({ rollbackArtifact: { commit: "<previous-commit>" } }).status, "BLOCKED");
});

test("malformed objects, unknown keys and nested credential fields are rejected without echo", () => {
  for (const value of [null, [], "secret", 5]) assert.notEqual(evaluate(value).status, "PREPARED_DECLARED_ONLY");
  for (const section of [null, "target", "rollbackArtifact", "compatibility"]) {
    const manifest = declaredManifest();
    (section ? manifest[section] : manifest).authorization = { secretKey: "DO_NOT_ECHO" };
    const result = evaluate(manifest);
    assert.equal(result.status, "BLOCKED");
    assert.equal(JSON.stringify(result).includes("DO_NOT_ECHO"), false);
  }
  const manifest = declaredManifest();
  manifest.rollbackArtifact.commit = { token: "DO_NOT_ECHO" };
  assert.equal(evaluate(manifest).status, "BLOCKED");
});

test("execution, data restore, migration and staging targets are forbidden", () => {
  for (const [key, value] of [["mode", "execute"], ["databaseAction", "restore"], ["storageAction", "restore"], ["migrationAction", "down"], ["appAction", "deploy"]]) {
    const manifest = declaredManifest();
    manifest[key] = value;
    assert.equal(evaluate(manifest).status, "BLOCKED");
  }
  for (const change of [
    (m) => { m.target.sitesProjectId = "staging_project"; },
    (m) => { m.target.supabaseProjectRef = "staging_project"; },
    (m) => { m.rollbackArtifact.provider = "cloudflare"; },
    (m) => { m.rollbackArtifact.projectId = "staging_project"; },
    (m) => { m.rollbackArtifact.immutableVersionId = "https://staging.pages.dev"; },
    (m) => { m.environmentPreservation.supabaseProjectRef = "staging_project"; },
  ]) {
    const manifest = declaredManifest();
    change(manifest);
    assert.equal(evaluate(manifest).status, "BLOCKED");
  }
});

test("exact fallback, baseline schema smoke and candidate schema compatibility remain separately bound", () => {
  for (const change of [
    (m) => { m.compatibility.artifactCommit = candidateCommit; },
    (m) => { m.compatibility.artifactVersionId = "different_artifact"; },
    (m) => { m.readOnlySmoke.artifactSha256 = "d".repeat(64); },
    (m) => { m.readOnlySmoke.schemaVersion = 202609070002; },
    (m) => { m.compatibility.schemaVersion = 202607240002; },
    (m) => { m.latestBackup.baselineCommit = candidateCommit; },
    (m) => { m.rollbackArtifact.immutableVersionId = otherArtifactId; },
    (m) => { m.rollbackArtifact.commit = candidateCommit; },
    (m) => { m.rollbackArtifact.version = "1.0.0"; },
    (m) => { m.rollbackArtifact.sha256 = "not-a-hash"; },
    (m) => { m.compatibility.verifiedAt = "2026-02-30T11:00:00.000Z"; },
  ]) {
    const manifest = declaredManifest();
    change(manifest);
    assert.equal(evaluate(manifest).status, "BLOCKED");
  }
  for (const [section, field] of [["compatibility", "unknownJsonFieldsPreserved"], ["compatibility", "scheduleRangesPreserved"], ["compatibility", "storageReferencesPreserved"], ["readOnlySmoke", "readOnly"], ["readOnlySmoke", "passed"], ["latestBackup", "databaseAndStorageVerified"], ["environmentPreservation", "keepCurrentBindings"], ["environmentPreservation", "credentialsUnchanged"]]) {
    const manifest = declaredManifest();
    manifest[section][field] = false;
    assert.equal(evaluate(manifest).status, "PREPARED_WITH_BLOCKERS");
  }
});

test("stale, future, or pre-backup evidence cannot pass", () => {
  const manifest = declaredManifest();
  manifest.latestBackup.capturedAt = "2026-11-02T10:00:00.000Z";
  manifest.latestBackup.verifiedAt = "2026-11-02T11:00:00.000Z";
  assert.equal(evaluate(manifest).status, "PREPARED_WITH_BLOCKERS");
  manifest.latestBackup.verifiedAt = "2026-11-05T11:00:00.000Z";
  assert.equal(evaluate(manifest).status, "BLOCKED");
  manifest.latestBackup.verifiedAt = verifiedAt;
  manifest.latestBackup.capturedAt = baselineAt;
  manifest.readOnlySmoke.verifiedAt = baselineAt;
  assert.equal(evaluate(manifest).status, "PREPARED_WITH_BLOCKERS");
  assert.equal(evaluateRollbackReadiness(declaredManifest()).status, "BLOCKED");
});

test("pre-deployment fallback pins current Production while candidate and schema differ", () => {
  const manifest = declaredManifest();
  assert.equal(manifest.rollbackArtifact.immutableVersionId, manifest.productionBaseline.immutableVersionId);
  assert.equal(manifest.rollbackArtifact.commit, manifest.productionBaseline.commit);
  assert.notEqual(manifest.releaseCandidate.commit, manifest.productionBaseline.commit);
  assert.notEqual(manifest.compatibility.schemaVersion, manifest.readOnlySmoke.schemaVersion);
  assert.equal(evaluate(manifest).status, "PREPARED_DECLARED_ONLY");

  manifest.releaseCandidate.commit = "d".repeat(40);
  assert.ok(evaluate(manifest).violations.includes("COMPATIBILITY_CANDIDATE_MISMATCH"));
  manifest.releaseCandidate.commit = manifest.productionBaseline.commit;
  assert.ok(evaluate(manifest).violations.includes("CANDIDATE_EQUALS_BASELINE_COMMIT"));
});

test("fresh evidence may follow baseline polling and same-commit backup may precede polling", () => {
  const manifest = declaredManifest();
  assert.ok(Date.parse(manifest.rollbackArtifact.capturedAt) > Date.parse(manifest.productionBaseline.observedAt));
  manifest.latestBackup.capturedAt = "2026-11-04T09:00:00.000Z";
  manifest.latestBackup.verifiedAt = "2026-11-04T09:30:00.000Z";
  assert.equal(evaluate(manifest).status, "PREPARED_DECLARED_ONLY");

  manifest.latestBackup.capturedAt = "2026-11-03T09:00:00.000Z";
  assert.ok(evaluate(manifest).blockers.includes("BACKUP_CAPTURED_AT_STALE"));
  manifest.latestBackup.capturedAt = "2026-11-04T09:00:00.000Z";
  manifest.productionBaseline.deployedAt = "2026-11-04T09:15:00.000Z";
  assert.ok(evaluate(manifest).blockers.includes("BACKUP_PREDATES_BASELINE_DEPLOYMENT"));
});

test("v1 manifest, wrong purpose, missing purpose and missing candidate cannot pass v2", () => {
  const old = declaredManifest();
  old.formatVersion = 1;
  assert.equal(evaluate(old).status, "BLOCKED");
  const wrongPurpose = declaredManifest();
  wrongPurpose.purpose = "incident-rollback";
  assert.equal(evaluate(wrongPurpose).status, "BLOCKED");
  for (const field of ["purpose", "releaseCandidate"]) {
    const manifest = declaredManifest();
    delete manifest[field];
    assert.equal(evaluate(manifest).status, "PREPARED_WITH_BLOCKERS");
  }
});

test("only one explicit local JSON path is accepted and flags/shell/URLs are rejected", () => {
  assert.equal(parsePrepareArguments(["./rollback-prepare.json"]), "./rollback-prepare.json");
  assert.equal(parsePrepareArguments(["/tmp/rollback-prepare.json"]), "/tmp/rollback-prepare.json");
  for (const args of [[], ["--execute"], ["--help"], ["manifest.json"], ["./manifest.json", "--execute"], ["https://example.com/manifest.json"], ["file:///tmp/manifest.json"], ["../manifest.json"], ["./x;curl.json"], ["./$(id).json"], ["./.env.production.json"], ["./x.json\n"]]) {
    assert.throws(() => parsePrepareArguments(args));
  }
});

test("manifest parsing is bounded and JSON error excerpts are never returned", () => {
  assert.deepEqual(parseRollbackManifest("{}"), {});
  assert.throws(() => parseRollbackManifest(" ".repeat(MAX_MANIFEST_BYTES + 1)), /MANIFEST_SIZE_INVALID/);
  assert.throws(() => parseRollbackManifest("DO_NOT_ECHO"), /^Error: MANIFEST_JSON_INVALID$/);
});

test("Sites version IDs require the canonical Production project composite shape", () => {
  assert.equal(evaluate(declaredManifest()).status, "PREPARED_DECLARED_ONLY");
  for (const id of [
    `appgprj_${"3".repeat(32)}~appgver_${"2".repeat(32)}`,
    `appgver_${"2".repeat(32)}`,
    `${PRODUCTION_SITES_PROJECT_ID}~arbitrary`,
    `${PRODUCTION_SITES_PROJECT_ID}~appgver_${"2".repeat(31)}`,
    `https://example.com/${rollbackArtifactId}`,
    `${rollbackArtifactId}\n`,
  ]) {
    const manifest = declaredManifest();
    manifest.rollbackArtifact.immutableVersionId = id;
    manifest.compatibility.artifactVersionId = id;
    manifest.readOnlySmoke.artifactVersionId = id;
    assert.equal(evaluate(manifest).status, "BLOCKED");
  }
});

function inMemoryFile({ payload = "{}", size = 2, openedSize = size, regular = true, symlink = false, chunkSize = Infinity } = {}) {
  const bytes = Buffer.from(payload);
  const calls = { opens: 0, reads: 0, closed: false, flags: 0, file: null };
  const adapters = {
    lstat: async (file) => {
      calls.file = file;
      return { size, isFile: () => regular, isSymbolicLink: () => symlink };
    },
    open: async (file, flags) => {
      assert.equal(file, calls.file);
      calls.opens += 1;
      calls.flags = flags;
      return {
        stat: async () => ({ size: openedSize, isFile: () => regular }),
        read: async (buffer, offset, length, position) => {
          calls.reads += 1;
          assert.ok(buffer.length <= MAX_MANIFEST_BYTES + 1);
          const count = Math.min(length, bytes.length - position, chunkSize);
          bytes.copy(buffer, offset, position, position + count);
          return { bytesRead: count };
        },
        close: async () => { calls.closed = true; },
      };
    },
  };
  return { adapters, calls };
}

test("CLI file boundary refuses symlinks, non-regular files and initial oversize before open", async () => {
  for (const options of [{ symlink: true }, { regular: false }, { size: MAX_MANIFEST_BYTES + 1 }]) {
    const { adapters, calls } = inMemoryFile(options);
    await assert.rejects(readExplicitManifest("./manifest.json", adapters), /MANIFEST_FILE_INVALID/);
    assert.equal(calls.opens, 0);
    assert.equal(calls.reads, 0);
  }
});

test("CLI file reader is bounded, handles short reads, and closes after success or rejection", async () => {
  const good = inMemoryFile({ chunkSize: 1 });
  assert.deepEqual(await readExplicitManifest("./manifest.json", good.adapters), {});
  assert.equal(good.calls.opens, 1);
  assert.equal(good.calls.reads, 3);
  assert.ok((good.calls.flags & constants.O_NOFOLLOW) !== 0);
  assert.equal(good.calls.closed, true);

  for (const [options, code] of [
    [{ openedSize: MAX_MANIFEST_BYTES + 1 }, /MANIFEST_FILE_INVALID/],
    [{ payload: " ".repeat(MAX_MANIFEST_BYTES + 1) }, /MANIFEST_SIZE_INVALID/],
    [{ payload: "DO_NOT_ECHO" }, /MANIFEST_JSON_INVALID/],
  ]) {
    const mock = inMemoryFile(options);
    await assert.rejects(readExplicitManifest("./manifest.json", mock.adapters), code);
    assert.equal(mock.calls.closed, true);
  }
});

test("main returns zero for declarations only and never grants execution or deployment", async () => {
  const messages = [];
  const exitCode = await main(["./manifest.json"], {
    readManifest: async (file) => {
      assert.equal(file, "./manifest.json");
      return declaredManifest();
    },
    output: (value) => messages.push(value),
    now: () => asOf,
  });
  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  const result = JSON.parse(messages[0]);
  assert.equal(result.policyVersion, 2);
  assert.equal(result.status, "PREPARED_DECLARED_ONLY");
  assert.equal(result.evidenceStatus, "DECLARED_NOT_VERIFIED");
  assert.equal(result.executionAvailable, false);
  assert.equal(result.deploymentAuthorized, false);
});

test("main rejects unsafe paths or flags before reading and returns one without reflecting input", async () => {
  for (const args of [["https://example.com/DO_NOT_ECHO.json"], ["--execute"]]) {
    const messages = [];
    let reads = 0;
    const exitCode = await main(args, {
      readManifest: async () => { reads += 1; return declaredManifest(); },
      output: (value) => messages.push(value),
      now: () => asOf,
    });
    assert.equal(exitCode, 1);
    assert.equal(reads, 0);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].includes("DO_NOT_ECHO"), false);
    assert.equal(messages[0].includes("--execute"), false);
    const result = JSON.parse(messages[0]);
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.violations, ["INPUT_REJECTED"]);
  }
});

test("main returns one for secret-bearing JSON or thrown errors and leaks neither content nor error", async () => {
  const secret = "DO_NOT_ECHO_SECRET";
  for (const readManifest of [
    async () => parseRollbackManifest(JSON.stringify({ ...declaredManifest(), secretKey: secret })),
    async () => { throw new Error(`private manifest /path/${secret}.json`); },
    async () => parseRollbackManifest(`invalid-json-${secret}`),
  ]) {
    const messages = [];
    const exitCode = await main(["./manifest.json"], {
      readManifest,
      output: (value) => messages.push(value),
      now: () => asOf,
    });
    assert.equal(exitCode, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].includes(secret), false);
    assert.equal(messages[0].includes("private manifest"), false);
    const result = JSON.parse(messages[0]);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.executionAvailable, false);
    assert.equal(result.deploymentAuthorized, false);
  }
});
