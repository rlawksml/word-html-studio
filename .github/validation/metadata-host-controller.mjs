// Executable only after the workflow pins this whole native-only closure.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bounded, readRegular, requireSuccess } from "./offline-host-support.mjs";
import { copyRuntime } from "./offline-host-runtime.mjs";
import { MetadataDocker } from "./metadata-export-docker.mjs";
import { decodePacket } from "./metadata-packet.mjs";
import { METADATA_LIMITS, validateCandidate, validateOriginalPair } from "./metadata-policy.mjs";
import { requireTransferApproval } from "./metadata-approval.mjs";
import { promotePair } from "./metadata-retained-check.mjs";

const abort = new AbortController();
let interrupted = false, phase = "START", docker, failed = false, promotion = null;
const interrupt = () => { interrupted = true; abort.abort(); };
process.on("SIGTERM", interrupt);
process.on("SIGINT", interrupt);
const deadline = setTimeout(interrupt, 8 * 60_000); // two-minute exact-cleanup reserve
const PHASES = new Set(["START", "INPUT", "LIMITS", "RUNTIME", "BUILD", "PREP", "SEAL", "CONSUMER", "HANDOFF", "EXPORT", "FINAL", "PROMOTE"]);
function stage(next) { assert.ok(PHASES.has(next)); phase = next; console.log(`METADATA_CONTROL_STAGE ${next}`); }
function checkpoint() { assert.equal(interrupted, false); }
const runtimeSteps = new Set(["PATHS", "NPM_METADATA", "NODE_VERSION", "NODE_COPY", "ENV_COPY", "NPM_COPY", "LDD", "OS_COMPAT_LIBRARY", "CA", "HELPERS"]);
function runtimeStep(value) { assert.ok(runtimeSteps.has(value)); console.log(`METADATA_RUNTIME_STAGE ${value}`); }
function decode(result, protocol, nonce) {
  const text = requireSuccess(result, "METADATA_STATUS_FAILED");
  assert.ok(result.stderr.length === 0 && result.stdout.length <= 16384);
  const value = JSON.parse(text);
  assert.equal(value.protocol, protocol);
  assert.equal(value.nonce, nonce);
  return value;
}
function candidateSummary(value) {
  assert.deepEqual(Object.keys(value), ["packageSha256", "lockSha256", "packageBytes", "lockBytes", "graph"]);
  for (const key of ["packageSha256", "lockSha256"]) assert.ok(typeof value[key] === "string" && value[key].length === 64 && /^[a-f0-9]{64}$/.test(value[key]));
  for (const [key, limit] of [["packageBytes", METADATA_LIMITS.package], ["lockBytes", METADATA_LIMITS.lock]]) {
    assert.ok(Number.isSafeInteger(value[key]) && value[key] > 0 && value[key] <= limit);
  }
  assert.deepEqual(Object.keys(value.graph), ["added", "removed", "changed", "unchanged"]);
  for (const count of Object.values(value.graph)) assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 4000);
  return value;
}
function publishNpmSummary(value) {
  assert.equal(value.stage, "npm_lock_only");
  assert.ok(value.exit === null || (Number.isInteger(value.exit) && value.exit >= 0 && value.exit <= 255));
  assert.ok(value.signal === null || /^SIG[A-Z0-9]+$/.test(value.signal));
  for (const key of ["limited", "error"]) assert.equal(typeof value[key], "boolean");
  for (const key of ["stdoutBytes", "stderrBytes", "observedWarningLines"]) assert.ok(Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 65536);
  assert.ok(value.stdoutBytes + value.stderrBytes <= 65536);
  for (const key of ["stdoutSha256", "stderrSha256"]) assert.ok(typeof value[key] === "string" && /^[a-f0-9]{64}$/.test(value[key]) && value[key].length === 64);
  // No raw npm log, native token, exception or arbitrary blockedReason escapes.
  console.log(`METADATA_NPM_SUMMARY ${JSON.stringify(Object.fromEntries([
    "stage", "exit", "signal", "limited", "error", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256", "observedWarningLines",
  ].map((key) => [key, value[key]])))}`);
  assert.equal(value.exit, 0);
  assert.equal(value.signal, null);
  assert.equal(value.limited, false);
  assert.equal(value.error, false);
  assert.equal(value.blockedReason, null);
}
async function originalPair(workspace, commit) {
  const git = (args) => bounded("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: workspace, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, signal: abort.signal,
  });
  assert.equal(requireSuccess(await git(["rev-parse", "HEAD"]), "METADATA_HEAD_FAILED").trim(), commit);
  const files = ["apps/web/package.json", "apps/web/package-lock.json"];
  const tree = requireSuccess(await git(["ls-tree", "-z", commit, "--", ...files]), "METADATA_TREE_FAILED").split("\0").filter(Boolean);
  assert.equal(tree.length, 2);
  const result = {};
  for (const row of tree) {
    const match = /^100644 blob ([a-f0-9]{40})\t(apps\/web\/package(?:-lock)?\.json)$/.exec(row);
    assert.ok(match && files.includes(match[2]));
    const kind = match[2].endsWith("package.json") ? "package" : "lock";
    assert.ok(!Object.hasOwn(result, kind));
    const bytes = readRegular(join(workspace, match[2]), METADATA_LIMITS[kind]);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), match[1]);
    result[kind] = bytes;
  }
  validateOriginalPair(result.package, result.lock); // metadata-only 4b79/bcd input pins
  return result;
}
function copyTrusted(source, destination, max = 32768) {
  const bytes = readRegular(source, max);
  writeFileSync(destination, bytes, { flag: "wx", mode: 0o444 });
  chmodSync(destination, 0o444);
  return bytes.length;
}
async function main() {
  assert.equal(process.platform, "linux");
  const [workspace, commit, scratch, node, npmCli, approval, checkedAt, ...extra] = process.argv.slice(2);
  assert.ok(!extra.length && typeof commit === "string" && commit.length === 40 && /^[a-f0-9]{40}$/.test(commit));
  assert.equal(realpathSync(workspace), workspace);
  assert.equal(realpathSync(scratch), scratch);
  assert.match(scratch, /^\/tmp\/bookstore-metadata-qa\.[A-Za-z0-9]{10}$/);
  const trusted = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
  assert.equal(trusted, `${scratch}/trusted`);
  assert.deepEqual(Object.keys(process.env).sort(), ["PATH", "TZ"]);
  assert.equal(process.env.PATH, "/usr/bin:/bin");
  assert.equal(process.env.TZ, "UTC");
  requireTransferApproval(approval, checkedAt);
  process.umask(0o022);
  chmodSync(scratch, 0o700);
  const nonce = randomBytes(16).toString("hex");
  stage("INPUT");
  const original = await originalPair(workspace, commit);
  checkpoint();
  docker = new MetadataDocker(scratch, nonce);
  docker.abortSignal = abort.signal;
  stage("LIMITS");
  await docker.requireLimits();

  // Reuse unchanged runtime assembly with explicitly reviewed launcher aliases.
  // Neither this alias directory nor the parent scratch is a container mount.
  const aliases = join(scratch, "runtime-aliases");
  mkdirSync(aliases, { mode: 0o755 });
  for (const file of ["offline-baseline.mjs", "offline-host-support.mjs", "offline-sandbox-common.mjs"]) copyTrusted(join(trusted, file), join(aliases, file));
  copyTrusted(join(trusted, "metadata-prep-launcher.mjs"), join(aliases, "offline-prep-launcher.mjs"));
  copyTrusted(join(trusted, "metadata-consumer-launcher.mjs"), join(aliases, "offline-app-launcher.mjs"));
  const contexts = {};
  stage("RUNTIME");
  for (const role of ["prep", "app"]) {
    const context = join(scratch, `${role}-context`), rootfs = join(context, "rootfs");
    mkdirSync(rootfs, { recursive: true, mode: 0o755 });
    copyTrusted(join(trusted, "offline-app.Dockerfile"), join(context, "Dockerfile"), 1024);
    const runtime = await copyRuntime(rootfs, node, npmCli, aliases, role, runtimeStep);
    let extraBytes = original.package.length + original.lock.length;
    for (const file of ["metadata-policy.mjs", "metadata-packet.mjs", "metadata-file-io.mjs"]) {
      extraBytes += copyTrusted(join(trusted, file), join(rootfs, "trusted", file));
    }
    assert.ok(runtime.totalBytes + extraBytes <= 448 * 1024 * 1024);
    // Only two immutable root manifests, never app source/config/data/keys.
    for (const [kind, name] of [["package", "package.json"], ["lock", "package-lock.json"]]) {
      writeFileSync(join(rootfs, "input", name), original[kind], { flag: "wx", mode: 0o444 });
    }
    contexts[role] = context;
    checkpoint();
  }
  stage("BUILD");
  const prepImage = await docker.build(contexts.prep), appImage = await docker.build(contexts.app);
  await docker.createVolume();
  stage("PREP");
  await docker.create("prep", prepImage);
  await docker.start("prep");
  const prepDeadline = Date.now() + 190_000;
  let prepared;
  while (Date.now() < prepDeadline) {
    checkpoint();
    const value = decode(await docker.exec("prep", "status"), "metadata-prep-v1", nonce);
    if (value.done === true) { prepared = value; break; }
    assert.deepEqual(value, { protocol: "metadata-prep-v1", nonce, ready: false, done: false });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(prepared);
  assert.deepEqual(Object.keys(prepared), ["protocol", "nonce", "done", "ready", "summary", "candidate"]);
  publishNpmSummary(prepared.summary);
  assert.equal(prepared.ready, true);
  const preparationCandidate = candidateSummary(prepared.candidate);
  stage("SEAL");
  await docker.sealPrepNetwork();
  stage("CONSUMER");
  await docker.create("app", appImage);
  await docker.start("app");
  const consumerDeadline = Date.now() + 10_000;
  let consumerReady = false;
  while (Date.now() < consumerDeadline) {
    checkpoint();
    const value = decode(await docker.exec("app", "status"), "metadata-consumer-v1", nonce);
    assert.deepEqual(value, { protocol: "metadata-consumer-v1", nonce, ready: value.ready });
    assert.equal(typeof value.ready, "boolean");
    if (value.ready) { consumerReady = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(consumerReady, true);
  stage("HANDOFF");
  await docker.inspectVolume();
  assert.deepEqual(decode(await docker.exec("prep", "status"), "metadata-prep-v1", nonce), prepared);
  await docker.remove("prep");
  assert.equal(docker.prepRemoved, true);
  stage("EXPORT");
  const exported = {};
  for (const [kind, action] of [["package", "export-package"], ["lock", "export-lock"]]) {
    checkpoint();
    const result = await docker.exportManifest(action);
    assert.ok(result.code === 0 && !result.signal && !result.error && !result.limited && result.stderr.length === 0);
    exported[kind] = decodePacket(result.stdout, kind, nonce);
  }
  const candidate = validateCandidate(original.package, original.lock, exported.package, exported.lock);
  assert.deepEqual(candidate, preparationCandidate);
  stage("FINAL");
  assert.deepEqual(decode(await docker.exec("app", "status"), "metadata-consumer-v1", nonce), { protocol: "metadata-consumer-v1", nonce, ready: true });
  const final = await docker.inspect("app");
  assert.ok(final.State.Running && !final.State.OOMKilled);
  await docker.inspectVolume();
  checkpoint();
  requireTransferApproval(approval, checkedAt);
  promotion = { scratch, commit, nonce, candidate, packageBytes: exported.package, lockBytes: exported.lock, approval, checkedAt };
}
try { await main(); }
catch { console.error(`METADATA_CONTROL_FAILURE stage=${PHASES.has(phase) ? phase : "START"}`); failed = true; }
finally {
  try { await docker?.cleanup(); }
  catch { console.error("METADATA_EXACT_CLEANUP_FAILED"); failed = true; }
  clearTimeout(deadline);
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
}
if (interrupted) failed = true;
if (!failed && promotion) {
  try {
    stage("PROMOTE");
    requireTransferApproval(promotion.approval, promotion.checkedAt);
    promotePair(promotion.scratch, promotion.packageBytes, promotion.lockBytes, { cleaned: true, commit: promotion.commit, nonce: promotion.nonce });
    console.log(`METADATA_COMPLETE ${JSON.stringify({ commit: promotion.commit, ...promotion.candidate, cleaned: true, files: 2, audit: "NOT_RUN", appValidation: "NOT_RUN" })}`);
  } catch { console.error("METADATA_PROMOTION_FAILED"); failed = true; }
}
if (failed || !promotion) { console.error("METADATA_PREPARATION_BLOCKED"); process.exitCode = 1; }
