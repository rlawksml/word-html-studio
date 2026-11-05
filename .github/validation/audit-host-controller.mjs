// This whole native-only closure must be reviewed/hash-pinned before execution.
// No source tree, npmrc, credential, Docker socket or host mount enters prep.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCK_SHA256, PACKAGE_SHA256 } from "./offline-baseline.mjs";
import { OwnedDocker } from "./offline-host-docker.mjs";
import { copyRuntime } from "./offline-host-runtime.mjs";
import { validateManifests } from "./offline-host-source.mjs";
import { bounded, readRegular, requireSuccess } from "./offline-host-support.mjs";
import { confirmCompletion, npmVersion, validateSummary } from "./audit-policy.mjs";
import { readStableFile } from "./audit-file-io.mjs";

const abort = new AbortController();
let interrupted = false, phase = "START", docker, completion = null, failed = false, cleaned = false;
const interrupt = () => { interrupted = true; abort.abort(); };
process.on("SIGTERM", interrupt);
process.on("SIGINT", interrupt);
const deadline = setTimeout(interrupt, 8 * 60_000); // workflow reserves 2 min for cleanup
const PHASES = new Set(["START", "INPUT", "LIMITS", "RUNTIME", "BUILD", "AUDIT", "SEAL", "FINAL"]);
const RUNTIME_STEPS = new Set(["PATHS", "NPM_METADATA", "NODE_VERSION", "NODE_COPY", "ENV_COPY", "NPM_COPY", "LDD", "OS_COMPAT_LIBRARY", "CA", "HELPERS"]);
function stage(value) { assert.ok(PHASES.has(value)); phase = value; console.log(`DEPENDENCY_AUDIT_STAGE ${value}`); }
function runtimeStep(value) { assert.ok(RUNTIME_STEPS.has(value)); console.log(`DEPENDENCY_AUDIT_RUNTIME_STAGE ${value}`); }
function checkpoint() { assert.equal(interrupted, false); }
function copyTrusted(source, destination, max = 32768) {
  const data = readRegular(source, max);
  writeFileSync(destination, data, { flag: "wx", mode: 0o444 });
  chmodSync(destination, 0o444);
  return data.length;
}
async function inputPair(workspace, commit) {
  const git = (args) => bounded("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: workspace, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, signal: abort.signal,
  });
  assert.equal(requireSuccess(await git(["rev-parse", "HEAD"]), "AUDIT_HEAD_FAILED").trim(), commit);
  const files = ["apps/web/package.json", "apps/web/package-lock.json"];
  const tree = requireSuccess(await git(["ls-tree", "-z", commit, "--", ...files]), "AUDIT_TREE_FAILED").split("\0").filter(Boolean);
  assert.equal(tree.length, 2);
  const pair = {};
  for (const row of tree) {
    const match = /^100644 blob ([a-f0-9]{40})\t(apps\/web\/package(?:-lock)?\.json)$/.exec(row);
    assert.ok(match && files.includes(match[2]));
    const kind = match[2].endsWith("package.json") ? "package" : "lock";
    assert.ok(!Object.hasOwn(pair, kind));
    const data = readStableFile(join(workspace, match[2]), kind === "package" ? 65536 : 2 * 1024 * 1024);
    assert.equal(createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex"), match[1]);
    pair[kind] = data;
  }
  validateManifests(pair.package, pair.lock); // candidate 4b79/bcd bytes only
  return pair;
}
function decodeStatus(result, nonce, version) {
  const raw = requireSuccess(result, "AUDIT_STATUS_FAILED");
  assert.ok(result.stderr.length === 0 && result.stdout.length <= 16384);
  const state = JSON.parse(raw);
  assert.equal(raw, `${JSON.stringify(state)}\n`);
  if (state.done === false) {
    assert.deepEqual(state, { protocol: "dependency-audit-v1", nonce, done: false });
    return state;
  }
  assert.deepEqual(Object.keys(state), ["protocol", "nonce", "done", "summary", "evidence"]);
  assert.equal(state.protocol, "dependency-audit-v1");
  assert.equal(state.nonce, nonce);
  assert.equal(state.done, true);
  validateSummary(state.summary, version);
  assert.deepEqual(state.evidence, { packageSha256: PACKAGE_SHA256, lockSha256: LOCK_SHA256, children: 0, preflight: true });
  return state;
}
async function main() {
  assert.equal(process.platform, "linux");
  const [workspace, commit, scratch, node, npmCli, approval, ...extra] = process.argv.slice(2);
  assert.ok(!extra.length && typeof commit === "string" && /^[a-f0-9]{40}$/.test(commit) && commit.length === 40);
  // Operator approval is rechecked by the parent before dispatch. This flag
  // alone is not proof of user permission to transmit the public lock graph.
  assert.equal(approval, "true");
  assert.equal(realpathSync(workspace), workspace);
  assert.equal(realpathSync(scratch), scratch);
  assert.match(scratch, /^\/tmp\/bookstore-audit-qa\.[A-Za-z0-9]{10}$/);
  const trusted = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
  assert.equal(trusted, `${scratch}/trusted`);
  assert.deepEqual(Object.keys(process.env).sort(), ["PATH", "TZ"]);
  assert.equal(process.env.PATH, "/usr/bin:/bin");
  assert.equal(process.env.TZ, "UTC");
  process.umask(0o022);
  chmodSync(scratch, 0o700);
  stage("INPUT");
  const pair = await inputPair(workspace, commit);
  assert.equal(realpathSync(npmCli), npmCli);
  assert.ok(/^\/(?:usr|opt)\//.test(npmCli) && npmCli.endsWith("/npm/bin/npm-cli.js"));
  const npmMetadata = JSON.parse(readRegular(join(dirname(dirname(npmCli)), "package.json"), 65536));
  assert.equal(npmMetadata.name, "npm");
  const version = npmVersion(npmMetadata.version);
  const nonce = randomBytes(16).toString("hex");
  docker = new OwnedDocker(scratch, nonce);
  docker.abortSignal = abort.signal;
  checkpoint();
  stage("LIMITS");
  await docker.requireLimits();
  const aliases = join(scratch, "runtime-aliases");
  mkdirSync(aliases, { mode: 0o755 });
  for (const name of ["offline-baseline.mjs", "offline-host-support.mjs", "offline-sandbox-common.mjs"]) copyTrusted(join(trusted, name), join(aliases, name));
  // copyRuntime's fixed prep launcher slot is reused, not widened/modified.
  copyTrusted(join(trusted, "audit-prep-launcher.mjs"), join(aliases, "offline-prep-launcher.mjs"));
  const context = join(scratch, "prep-context"), rootfs = join(context, "rootfs");
  mkdirSync(rootfs, { recursive: true, mode: 0o755 });
  copyTrusted(join(trusted, "offline-app.Dockerfile"), join(context, "Dockerfile"), 1024);
  stage("RUNTIME");
  const runtime = await copyRuntime(rootfs, node, npmCli, aliases, "prep", runtimeStep);
  let added = pair.package.length + pair.lock.length;
  for (const name of ["audit-policy.mjs", "audit-file-io.mjs"]) added += copyTrusted(join(trusted, name), join(rootfs, "trusted", name));
  assert.ok(runtime.totalBytes + added <= 448 * 1024 * 1024);
  for (const [kind, name] of [["package", "package.json"], ["lock", "package-lock.json"]]) {
    writeFileSync(join(rootfs, "input", name), pair[kind], { flag: "wx", mode: 0o444 });
  }
  checkpoint();
  stage("BUILD");
  const image = await docker.build(context);
  await docker.createVolume(); // empty tmpfs required by unchanged preflight
  stage("AUDIT");
  await docker.create("prep", image);
  await docker.start("prep");
  const auditDeadline = Date.now() + 110_000;
  let prepared;
  while (Date.now() < auditDeadline) {
    checkpoint();
    const value = decodeStatus(await docker.exec("prep", "status"), nonce, version);
    if (value.done) { prepared = value; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(prepared);
  stage("SEAL");
  await docker.sealPrepNetwork();
  stage("FINAL");
  // After sealing, repeat leaf hashes, process quiescence and effective OS
  // preflight; do not trust only an HTTP response or the audit process exit.
  assert.deepEqual(decodeStatus(await docker.exec("prep", "status"), nonce, version), prepared);
  const final = await docker.inspect("prep");
  assert.ok(final.State.Running && !final.State.OOMKilled && docker.prepSealed);
  await docker.inspectVolume();
  checkpoint();
  completion = { summary: prepared.summary, version, evidence: { ...prepared.evidence,
    networkSealed: docker.prepSealed, running: final.State.Running, oomKilled: final.State.OOMKilled, cleaned: false } };
}
try { await main(); }
catch { console.error(`DEPENDENCY_AUDIT_CONTROL_BLOCKED stage=${PHASES.has(phase) ? phase : "START"}`); failed = true; }
finally {
  try { await docker?.cleanup(); cleaned = true; }
  catch { console.error("DEPENDENCY_AUDIT_CLEANUP_UNCONFIRMED"); failed = true; }
  clearTimeout(deadline);
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
}
if (interrupted) failed = true;
if (!failed && completion && cleaned) {
  try {
    completion.evidence.cleaned = true;
    const result = confirmCompletion(completion.summary, completion.evidence,
      { packageSha256: PACKAGE_SHA256, lockSha256: LOCK_SHA256 }, completion.version);
    // Raw JSON/log/name/path/title/range/URL/headers/body never leave prep.
    // COMPLETE means controls/cleanup completed, not "vulnerabilities absent".
    console.log(`DEPENDENCY_AUDIT_COMPLETE ${JSON.stringify(result)}`);
    process.exitCode = result.outcome === "PASS" ? 0 : 1;
  } catch { console.error("DEPENDENCY_AUDIT_RESULT_BLOCKED"); failed = true; }
}
if (failed || !completion || !cleaned) { console.error("DEPENDENCY_AUDIT_BLOCKED"); process.exitCode = 1; }
