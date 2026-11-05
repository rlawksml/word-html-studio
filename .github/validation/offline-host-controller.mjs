// Host entrypoint is inert until workflow hashes the ENTIRE import closure.
// Only native builtins + those reviewed, copied siblings may be imported here.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_TESTS, LOCK_SHA256, PACKAGE_SHA256 } from "./offline-baseline.mjs";
import { OwnedDocker } from "./offline-host-docker.mjs";
import { copyRuntime } from "./offline-host-runtime.mjs";
import { copyReviewedSources } from "./offline-host-source.mjs";
import { fixedError, readRegular, requireSuccess } from "./offline-host-support.mjs";

const abort = new AbortController();
let interrupted = false;
const interrupt = () => { interrupted = true; abort.abort(); };
process.on("SIGTERM", interrupt);
process.on("SIGINT", interrupt);
// Leave two minutes for exact-owned cleanup before the 15-minute workflow cap.
const deadline = setTimeout(interrupt, 13 * 60_000);
let docker;
let failed = null;
let completion = null;
const CONTROL_STAGES = new Set([
  "START", "DAEMON_LIMITS", "RUNTIME_PREP", "RUNTIME_APP", "SOURCE_VALIDATION",
  "IMAGE_BUILD_PREP", "IMAGE_BUILD_APP", "VOLUME", "PREP_CREATE", "PREP_START",
  "PREP_STATUS", "SEAL_PREP", "CONSUMER_CREATE", "CONSUMER_START",
  "CONSUMER_READY", "HANDOFF", "APP_RUN", "FINAL_CHECK",
]);
const TRUSTED_FAILURES = new Set([
  "OFFLINE_HOST_DEADLINE_OR_SIGNAL", "TRUSTED_NODE_VERSION_UNCONFIRMED", "TRUSTED_RUNTIME_LDD_FAILED",
  "SOURCE_HEAD_UNCONFIRMED", "SOURCE_TREE_UNCONFIRMED", "DAEMON_LIMITS_UNCONFIRMED",
  "VOLUME_ABSENCE_UNCONFIRMED", "VOLUME_INSPECTION_UNCONFIRMED", "VOLUME_CREATION_UNCONFIRMED",
  "IMAGE_BUILD_FAILED_OR_LIMITED", "IMAGE_INSPECTION_UNCONFIRMED", "CONTAINER_ABSENCE_UNCONFIRMED",
  "CONTAINER_CREATION_UNCONFIRMED", "CONTAINER_INSPECTION_UNCONFIRMED", "CONTAINER_START_UNCONFIRMED",
  "PREP_STATUS_UNCONFIRMED", "PREP_WALL_LIMIT_EXCEEDED", "PREP_NETWORK_DISCONNECT_UNCONFIRMED",
  "OFFLINE_CONSUMER_MOUNT_UNCONFIRMED", "PREP_QUIESCENCE_UNCONFIRMED",
  "OWNED_CONTAINER_REMOVE_UNCONFIRMED", "OFFLINE_TRUSTED_SUMMARY_UNCONFIRMED", "OFFLINE_APP_FAILED_OR_LIMITED",
]);
const ERROR_CLASSES = new Set(["ERR_ASSERTION", "ENOENT", "EACCES", "EPERM", "ENOSPC", "EMFILE"]);
const RUNTIME_STEPS = new Set([
  "PATHS", "NPM_METADATA", "NODE_VERSION", "NODE_COPY", "ENV_COPY",
  "NPM_COPY", "LDD", "CA", "HELPERS",
]);
let phase = "START";
function controlStage(value) {
  assert.ok(CONTROL_STAGES.has(value));
  phase = value;
  // Fixed controller labels only, never a path, exception message or target log.
  console.log(`OFFLINE_CONTROL_STAGE ${value}`);
}
function runtimeStep(value) {
  assert.ok(RUNTIME_STEPS.has(value));
  console.log(`OFFLINE_RUNTIME_STAGE ${value}`);
}
function checkpoint() { if (interrupted) throw fixedError("OFFLINE_HOST_DEADLINE_OR_SIGNAL"); }
function decode(result, protocol, nonce, code) {
  const text = requireSuccess(result, code);
  assert.ok(result.stderr.length === 0 && text.length <= 16384);
  const value = JSON.parse(text);
  assert.equal(value.protocol, protocol);
  assert.equal(value.nonce, nonce);
  return value;
}
function validateSummary(value, expectedStage) {
  assert.equal(value.stage, expectedStage);
  assert.equal(value.exit, 0);
  assert.equal(value.signal, null);
  assert.equal(value.limited, false);
  assert.equal(value.error, false);
  assert.equal(value.blockedReason, null);
  for (const field of ["stdoutBytes", "stderrBytes", "observedWarningLines"]) assert.ok(Number.isSafeInteger(value[field]) && value[field] >= 0 && value[field] <= 65536);
  assert.ok(value.stdoutBytes + value.stderrBytes <= 65536);
  for (const field of ["stdoutSha256", "stderrSha256"]) assert.match(value[field], /^[a-f0-9]{64}$/);
}
// Only fixed labels, numeric counters, digests, and reviewed commit metadata
// reach the Actions log. No raw app/npm/TAP output or env/config is published.
function publishSummary(value) {
  const allowedReasons = new Set([null, "TIMEOUT", "OUTPUT_CAP", "ABORTED", "NATIVE_SHARED_LIBRARY_UNAVAILABLE", "INSTALL_SCRIPT_OUTPUT_UNAVAILABLE", "SHELL_OR_NATIVE_EXECUTABLE_UNAVAILABLE", "DUPLICATE_NPM_CONFIG_PATH"]);
  assert.ok(["npm_ci_ignore_scripts", "typecheck", "lint", "build", "unit"].includes(value.stage));
  assert.ok(value.exit === null || (Number.isInteger(value.exit) && value.exit >= 0 && value.exit <= 255));
  assert.ok(value.signal === null || /^SIG[A-Z0-9]+$/.test(value.signal));
  assert.equal(typeof value.limited, "boolean");
  assert.equal(typeof value.error, "boolean");
  assert.ok(allowedReasons.has(value.blockedReason));
  for (const field of ["stdoutBytes", "stderrBytes", "observedWarningLines"]) assert.ok(Number.isInteger(value[field]) && value[field] >= 0 && value[field] <= 65536);
  for (const field of ["stdoutSha256", "stderrSha256"]) assert.match(value[field], /^[a-f0-9]{64}$/);
  const selected = Object.fromEntries(["stage", "exit", "signal", "limited", "error", "blockedReason", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256", "observedWarningLines"].map((key) => [key, value[key]]));
  console.log(`OFFLINE_STAGE_SUMMARY ${JSON.stringify(selected)}`);
}
function publishTypeDiagnostics(value, sourcePaths) {
  if (value.stage !== "typecheck" || value.typeDiagnostics === undefined) return;
  assert.ok(Array.isArray(value.typeDiagnostics) && value.typeDiagnostics.length <= 20);
  const selected = value.typeDiagnostics.map((entry) => {
    assert.ok(Number.isInteger(entry.code) && entry.code >= 1000 && entry.code <= 99999);
    if (entry.file === null) assert.ok(entry.line === null && entry.column === null);
    else {
      assert.ok(typeof entry.file === "string" && sourcePaths.includes(`apps/web/${entry.file}`));
      for (const number of [entry.line, entry.column]) assert.ok(Number.isInteger(number) && number >= 1 && number <= 9999999);
    }
    return { code: entry.code, file: entry.file, line: entry.line, column: entry.column };
  });
  // Only an owned public source location + compiler number, no error message.
  console.log(`OFFLINE_TYPECHECK_DIAGNOSTICS ${JSON.stringify(selected)}`);
}
async function main() {
  assert.equal(process.platform, "linux");
  const [workspace, commit, scratch, node, npmCli, ...extra] = process.argv.slice(2);
  assert.ok(!extra.length);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(realpathSync(workspace), workspace);
  assert.equal(realpathSync(scratch), scratch);
  assert.match(scratch, /^\/tmp\/bookstore-offline-qa\.[A-Za-z0-9]{10}$/);
  const trusted = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
  assert.equal(trusted, `${scratch}/trusted`);
  assert.deepEqual(Object.keys(process.env).sort(), ["PATH", "TZ"]);
  assert.equal(process.env.PATH, "/usr/bin:/bin");
  assert.equal(process.env.TZ, "UTC");
  // Private parent scratch remains 0700; image dirs must be traversable by the
  // nonroot image user. Every copied source is explicitly read-only.
  process.umask(0o022);
  chmodSync(scratch, 0o700);
  const nonce = randomBytes(16).toString("hex");
  docker = new OwnedDocker(scratch, nonce);
  docker.abortSignal = abort.signal;
  controlStage("DAEMON_LIMITS");
  await docker.requireLimits();
  checkpoint();

  const contexts = {};
  for (const role of ["prep", "app"]) {
    const context = join(scratch, `${role}-context`), rootfs = join(context, "rootfs");
    mkdirSync(rootfs, { recursive: true, mode: 0o755 });
    writeFileSync(join(context, "Dockerfile"), readRegular(join(trusted, "offline-app.Dockerfile"), 1024), { flag: "wx", mode: 0o444 });
    controlStage(role === "prep" ? "RUNTIME_PREP" : "RUNTIME_APP");
    await copyRuntime(rootfs, node, npmCli, trusted, role, runtimeStep);
    contexts[role] = { context, rootfs };
    checkpoint();
  }
  controlStage("SOURCE_VALIDATION");
  const source = await copyReviewedSources(workspace, commit, contexts.app.rootfs);
  const metadata = { commit, sourceDigest: source.digest, files: source.files, bytes: source.bytes };
  mkdirSync(join(contexts.app.rootfs, "metadata"), { mode: 0o755 });
  writeFileSync(join(contexts.app.rootfs, "metadata/review.json"), JSON.stringify(metadata), { flag: "wx", mode: 0o444 });
  // Prep sees these TWO root manifests only, not /source or checkout/config.
  writeFileSync(join(contexts.prep.rootfs, "input/package.json"), source.packageBytes, { flag: "wx", mode: 0o444 });
  writeFileSync(join(contexts.prep.rootfs, "input/package-lock.json"), source.lockBytes, { flag: "wx", mode: 0o444 });
  controlStage("IMAGE_BUILD_PREP");
  const prepImage = await docker.build(contexts.prep.context);
  controlStage("IMAGE_BUILD_APP");
  const appImage = await docker.build(contexts.app.context);
  checkpoint();
  controlStage("VOLUME");
  await docker.createVolume();
  controlStage("PREP_CREATE");
  await docker.create("prep", prepImage);
  controlStage("PREP_START");
  await docker.start("prep");
  const prepDeadline = Date.now() + 190_000;
  let prepared;
  controlStage("PREP_STATUS");
  while (Date.now() < prepDeadline) {
    checkpoint();
    const value = decode(await docker.exec("prep", "status"), "offline-prep-v1", nonce, "PREP_STATUS_UNCONFIRMED");
    if (value.done === true) { prepared = value; break; }
    assert.equal(value.done, false);
    assert.equal(value.ready, false);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!prepared) throw fixedError("PREP_WALL_LIMIT_EXCEEDED");
  publishSummary(prepared.summary);
  validateSummary(prepared.summary, "npm_ci_ignore_scripts");
  assert.equal(prepared.ready, true);
  controlStage("SEAL_PREP");
  await docker.sealPrepNetwork();
  // REQUIRED order for Docker local tmpfs: verified READY prep stays alive;
  // readonly offline idle consumer starts and holds the mount; ONLY THEN prep
  // is removed and its absence confirmed. No app runs in idle/status mode.
  controlStage("CONSUMER_CREATE");
  await docker.create("app", appImage);
  controlStage("CONSUMER_START");
  await docker.start("app");
  const consumerDeadline = Date.now() + 10_000;
  let consumerReady = false;
  controlStage("CONSUMER_READY");
  while (Date.now() < consumerDeadline) {
    const consumer = decode(await docker.exec("app", "status"), "offline-consumer-v1", nonce, "OFFLINE_CONSUMER_MOUNT_UNCONFIRMED");
    if (consumer.ready === true) { consumerReady = true; break; }
    assert.equal(consumer.ready, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(consumerReady, true);
  controlStage("HANDOFF");
  await docker.inspectVolume();
  const finalPrep = decode(await docker.exec("prep", "status"), "offline-prep-v1", nonce, "PREP_QUIESCENCE_UNCONFIRMED");
  assert.deepEqual(finalPrep, prepared);
  await docker.remove("prep");
  assert.equal(docker.prepRemoved, true);
  checkpoint();
  controlStage("APP_RUN");
  const execution = await docker.exec("app", "run", 500_000);
  // Failed runs still publish ONLY validated stage metadata, never target text.
  let result;
  try {
    assert.ok(execution.stdout.length <= 16384 && execution.stderr.length === 0);
    result = JSON.parse(execution.stdout.toString("utf8"));
    assert.equal(result.protocol, "offline-app-v1");
    assert.equal(result.nonce, nonce);
    if (result.ok === false) {
      assert.ok(["START", "PREFLIGHT", "READINESS", "SOURCE_CLONE", "TOOLCHAIN_LINK", "TYPECHECK", "LINT", "BUILD", "UNIT", "POST_STAGE"].includes(result.controlPhase));
      assert.ok([...ERROR_CLASSES, "OTHER"].includes(result.category));
      console.log(`OFFLINE_APP_CONTROL phase=${result.controlPhase} category=${result.category}`);
    }
    assert.ok(Array.isArray(result.stages) && result.stages.length <= 4);
    for (const summary of result.stages) {
      publishSummary(summary);
      publishTypeDiagnostics(summary, source.sourcePaths);
    }
  } catch { throw fixedError("OFFLINE_TRUSTED_SUMMARY_UNCONFIRMED"); }
  requireSuccess(execution, "OFFLINE_APP_FAILED_OR_LIMITED");
  assert.equal(result.nonce, nonce);
  assert.equal(result.ok, true);
  assert.equal(result.commit, commit);
  assert.equal(result.sourceDigest, source.digest);
  assert.equal(result.stages.length, 4);
  ["typecheck", "lint", "build", "unit"].forEach((name, index) => validateSummary(result.stages[index], name));
  assert.deepEqual(result.stages[3].tap, { tests: EXPECTED_TESTS, pass: EXPECTED_TESTS, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  controlStage("FINAL_CHECK");
  const final = await docker.inspect("app");
  assert.ok(final.State.Running && !final.State.OOMKilled);
  checkpoint();
  completion = `OFFLINE_APP_COMPLETE commit=${commit} source_sha256=${source.digest} package_sha256=${PACKAGE_SHA256} lock_sha256=${LOCK_SHA256} tests=${EXPECTED_TESTS}`;
}
try { await main(); }
catch (error) {
  // Only exact, reviewed classifications leave the host. Do not publish raw
  // message/stack/path/syscall/cause or an arbitrary code/safeCode value.
  const category = ERROR_CLASSES.has(error?.code) ? error.code : "OTHER";
  const label = CONTROL_STAGES.has(phase) ? phase : "START";
  console.error(`OFFLINE_CONTROL_FAILURE stage=${label} category=${category}`);
  failed = TRUSTED_FAILURES.has(error?.safeCode) ? error.safeCode : "OFFLINE_TRUSTED_CONTROL_OR_PREFLIGHT_FAILED";
}
finally {
  try { await docker?.cleanup(); }
  catch { failed = "EXACT_OWNED_CLEANUP_UNCONFIRMED"; }
  clearTimeout(deadline);
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
}
if (interrupted && !failed) failed = "OFFLINE_HOST_DEADLINE_OR_SIGNAL";
if (failed) { console.error(`::error::${failed}`); process.exitCode = 1; }
else if (completion) console.log(completion);
