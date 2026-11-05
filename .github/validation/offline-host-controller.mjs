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
  const allowedReasons = new Set([null, "TIMEOUT", "OUTPUT_CAP", "ABORTED", "NATIVE_SHARED_LIBRARY_UNAVAILABLE", "INSTALL_SCRIPT_OUTPUT_UNAVAILABLE", "SHELL_OR_NATIVE_EXECUTABLE_UNAVAILABLE"]);
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
  await docker.requireLimits();
  checkpoint();

  const contexts = {};
  for (const role of ["prep", "app"]) {
    const context = join(scratch, `${role}-context`), rootfs = join(context, "rootfs");
    mkdirSync(rootfs, { recursive: true, mode: 0o755 });
    writeFileSync(join(context, "Dockerfile"), readRegular(join(trusted, "offline-app.Dockerfile"), 1024), { flag: "wx", mode: 0o444 });
    await copyRuntime(rootfs, node, npmCli, trusted, role);
    contexts[role] = { context, rootfs };
    checkpoint();
  }
  const source = await copyReviewedSources(workspace, commit, contexts.app.rootfs);
  const metadata = { commit, sourceDigest: source.digest, files: source.files, bytes: source.bytes };
  mkdirSync(join(contexts.app.rootfs, "metadata"), { mode: 0o755 });
  writeFileSync(join(contexts.app.rootfs, "metadata/review.json"), JSON.stringify(metadata), { flag: "wx", mode: 0o444 });
  // Prep sees these TWO root manifests only, not /source or checkout/config.
  writeFileSync(join(contexts.prep.rootfs, "input/package.json"), source.packageBytes, { flag: "wx", mode: 0o444 });
  writeFileSync(join(contexts.prep.rootfs, "input/package-lock.json"), source.lockBytes, { flag: "wx", mode: 0o444 });
  const prepImage = await docker.build(contexts.prep.context);
  const appImage = await docker.build(contexts.app.context);
  checkpoint();
  await docker.createVolume();
  await docker.create("prep", prepImage);
  await docker.start("prep");
  const prepDeadline = Date.now() + 190_000;
  let prepared;
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
  await docker.sealPrepNetwork();
  // REQUIRED order for Docker local tmpfs: verified READY prep stays alive;
  // readonly offline idle consumer starts and holds the mount; ONLY THEN prep
  // is removed and its absence confirmed. No app runs in idle/status mode.
  await docker.create("app", appImage);
  await docker.start("app");
  const consumerDeadline = Date.now() + 10_000;
  let consumerReady = false;
  while (Date.now() < consumerDeadline) {
    const consumer = decode(await docker.exec("app", "status"), "offline-consumer-v1", nonce, "OFFLINE_CONSUMER_MOUNT_UNCONFIRMED");
    if (consumer.ready === true) { consumerReady = true; break; }
    assert.equal(consumer.ready, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(consumerReady, true);
  await docker.inspectVolume();
  const finalPrep = decode(await docker.exec("prep", "status"), "offline-prep-v1", nonce, "PREP_QUIESCENCE_UNCONFIRMED");
  assert.deepEqual(finalPrep, prepared);
  await docker.remove("prep");
  assert.equal(docker.prepRemoved, true);
  checkpoint();
  const execution = await docker.exec("app", "run", 500_000);
  // Failed runs still publish ONLY validated stage metadata, never target text.
  let result;
  try {
    assert.ok(execution.stdout.length <= 16384 && execution.stderr.length === 0);
    result = JSON.parse(execution.stdout.toString("utf8"));
    assert.equal(result.protocol, "offline-app-v1");
    assert.ok(Array.isArray(result.stages) && result.stages.length <= 4);
    for (const summary of result.stages) publishSummary(summary);
  } catch { throw fixedError("OFFLINE_TRUSTED_SUMMARY_UNCONFIRMED"); }
  requireSuccess(execution, "OFFLINE_APP_FAILED_OR_LIMITED");
  assert.equal(result.nonce, nonce);
  assert.equal(result.ok, true);
  assert.equal(result.commit, commit);
  assert.equal(result.sourceDigest, source.digest);
  assert.equal(result.stages.length, 4);
  ["typecheck", "lint", "build", "unit"].forEach((name, index) => validateSummary(result.stages[index], name));
  assert.deepEqual(result.stages[3].tap, { tests: EXPECTED_TESTS, pass: EXPECTED_TESTS, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const final = await docker.inspect("app");
  assert.ok(final.State.Running && !final.State.OOMKilled);
  checkpoint();
  completion = `OFFLINE_APP_COMPLETE commit=${commit} source_sha256=${source.digest} package_sha256=${PACKAGE_SHA256} lock_sha256=${LOCK_SHA256} tests=${EXPECTED_TESTS}`;
}
try { await main(); }
catch (error) { failed = error?.safeCode ?? "OFFLINE_TRUSTED_CONTROL_OR_PREFLIGHT_FAILED"; }
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
