// No application executes in PID1, status, or idle mode. The host invokes run
// only AFTER a verified readonly consumer mount and confirmed prep removal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_ENV, EXPECTED_TESTS, EXPECTED_WORKER_TESTS, LOCK_SHA256, PACKAGE_SHA256, TESTS, WORKER_TESTS } from "./offline-baseline.mjs";
import { bounded, fixedError, readRegular, sha256 } from "./offline-host-support.mjs";
import { delay, emit, jsonFile, noOtherProcesses, preflight, summarize, validNonce } from "./offline-sandbox-common.mjs";
import { ARTIFACT_FAILURES, collectCompiledArtifact, stagingArtifactPathHint, verifyCompiledArtifact } from "./staging-compiled-artifact.mjs";

const summaries = [];
const readiness = "/scratch/consumer-ready.json";
const PHASES = new Set(["START", "PREFLIGHT", "READINESS", "SOURCE_CLONE", "TOOLCHAIN_LINK", "TYPECHECK", "LINT", "BUILD", "UNIT", "STAGING_WORKER", "POST_STAGE", "ARTIFACT"]);
const ERROR_CLASSES = new Set(["ERR_ASSERTION", "ENOENT", "EACCES", "EPERM", "ENOSPC", "EMFILE"]);
let phase = "START", executionNonce = null;
let processSnapshot = null;
const ownedAppSources = new Set();
function typecheckDiagnostics(bytes) {
  const selected = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    const match = /^(?:(.+)\((\d{1,7}),(\d{1,7})\): )?error TS(\d{4,5}):/.exec(line);
    if (!match || selected.length >= 20) continue;
    const file = match[1]?.replace(/^\.\//, "") ?? null;
    if (file !== null && !ownedAppSources.has(file)) continue;
    const row = file === null ? null : Number(match[2]);
    const column = file === null ? null : Number(match[3]);
    if (file !== null && (row < 1 || column < 1)) continue;
    selected.push({ code: Number(match[4]), file, line: row, column });
  }
  return selected;
}
function cloneSource() {
  const metadata = jsonFile("/metadata/review.json");
  assert.match(metadata.commit, /^[a-f0-9]{40}$/);
  assert.match(metadata.sourceDigest, /^[a-f0-9]{64}$/);
  const digest = createHash("sha256");
  const digestRecords = [];
  let files = 0, total = 0;
  function visit(relative) {
    const source = join("/source", relative);
    const info = lstatSync(source);
    assert.ok(!info.isSymbolicLink());
    if (info.isDirectory()) {
      mkdirSync(join("/scratch/repo", relative), { recursive: true, mode: 0o700 });
      for (const name of readdirSync(source).sort()) {
        assert.ok(name && ![".", ".."].includes(name) && !/[\x00-\x1f\x7f\\]/.test(name));
        visit(relative ? `${relative}/${name}` : name);
      }
      return;
    }
    assert.ok(info.isFile() && info.size <= 16 * 1024 * 1024);
    const bytes = readFileSync(source);
    total += bytes.length;
    files++;
    assert.ok(total <= 64 * 1024 * 1024 && files <= 2000);
    const destination = join("/scratch/repo", relative);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    digestRecords.push({ path: relative, hash: sha256(bytes) });
  }
  visit("");
  assert.equal(files, metadata.files);
  assert.equal(total, metadata.bytes);
  // Git orders complete UTF8 paths; recursive directory traversal does not
  // (e.g. drizzle.config.ts versus drizzle/meta). Hash the same bytewise order.
  digestRecords.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  for (const record of digestRecords) digest.update(record.path).update("\0").update(record.hash).update("\0");
  assert.equal(digest.digest("hex"), metadata.sourceDigest);
  for (const record of digestRecords) if (record.path.startsWith("apps/web/")) ownedAppSources.add(record.path.slice(9));
  for (const [name, expected] of [["package.json", PACKAGE_SHA256], ["package-lock.json", LOCK_SHA256]]) {
    assert.equal(sha256(readFileSync(`/toolchain/${name}`)), expected);
    assert.equal(sha256(readFileSync(`/scratch/repo/apps/web/${name}`)), expected);
  }
  return metadata;
}
function linkPackages() {
  const source = "/toolchain/node_modules", target = "/scratch/repo/apps/web/node_modules";
  mkdirSync(target, { mode: 0o700 });
  const packageName = /^[a-z0-9._-]+$/;
  const link = (relative) => {
    const path = `${source}/${relative}`;
    const info = lstatSync(path);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    symlinkSync(path, `${target}/${relative}`, "dir");
  };
  for (const name of readdirSync(source)) {
    if ([".bin", ".package-lock.json"].includes(name)) continue;
    if (name.startsWith("@")) {
      assert.ok(packageName.test(name.slice(1)));
      const info = lstatSync(`${source}/${name}`);
      assert.ok(info.isDirectory() && !info.isSymbolicLink());
      mkdirSync(`${target}/${name}`, { mode: 0o700 });
      for (const child of readdirSync(`${source}/${name}`)) {
        assert.ok(packageName.test(child) && ![".", ".."].includes(child));
        link(`${name}/${child}`);
      }
    } else {
      assert.ok(packageName.test(name) && ![".", ".."].includes(name));
      link(name);
    }
  }
  // This is an OWN writable directory, not a whole-node_modules symlink.
  // Vite's .vite-temp may be created here, while packages stay readonly.
  assert.ok(lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink());
}
function verifySpec(bytes, expectedTests, observe) {
  const text = bytes.toString("utf8");
  const counters = {};
  for (const name of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    // Node's built-in spec reporter keeps the same six root counters while
    // avoiding TAP's per-test YAML timing blocks. No TC/title/cap is removed.
    const matches = [...text.matchAll(new RegExp(`^ℹ ${name} (\\d+)$`, "gm"))];
    assert.equal(matches.length, 1);
    counters[name] = Number(matches[0][1]);
    assert.ok(Number.isSafeInteger(counters[name]) && counters[name] >= 0 && counters[name] <= 100000);
  }
  observe({ ...counters }); // counters only; completion still requires all checks
  assert.equal(counters.tests, expectedTests);
  assert.equal(counters.pass, expectedTests);
  for (const name of ["fail", "cancelled", "skipped", "todo"]) assert.equal(counters[name], 0);
  assert.ok(!/^✖ /m.test(text));
  return counters;
}
function unitFailureLocations(bytes, testFiles) {
  const locations = [];
  const seen = new Set();
  for (const outputLine of bytes.toString("utf8").split("\n")) {
    // Keep the test declaration location and exact sandbox-owned TestContext
    // assertion frames only; never emit the surrounding message or raw stack.
    const match = /^test at (tests\/[A-Za-z0-9._-]+\.mjs):(\d{1,7}):(\d{1,7})$/.exec(outputLine)
      || /^\s+at (?:async )?TestContext(?:\.[A-Za-z0-9_$<>.]+)? \((?:file:\/\/)?\/scratch\/repo\/apps\/web\/(tests\/[A-Za-z0-9._-]+\.mjs):(\d{1,7}):(\d{1,7})\)$/.exec(outputLine);
    if (!match || !testFiles.includes(match[1]) || locations.length >= 20) continue;
    const line = Number(match[2]), column = Number(match[3]);
    const key = `${match[1]}:${line}:${column}`;
    if (line > 0 && column > 0 && !seen.has(key)) {
      locations.push({ file: match[1], line, column });
      seen.add(key);
    }
  }
  return locations; // owned public source locations only, never error text
}
function summarizeRemainingProcesses() {
  const pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).filter((name) => ![1, process.pid].includes(Number(name)));
  assert.ok(pids.length <= 128);
  const result = { live: 0, zombie: 0, gone: 0, parent1: 0, node: 0, esbuild: 0, workerd: 0, other: 0 };
  for (const pid of pids) {
    let status;
    try { status = readRegular(`/proc/${pid}/status`, 16384).toString("utf8"); }
    catch (error) {
      if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
      result.gone++;
      continue;
    }
    const state = /^State:\s+([A-Za-z])/m.exec(status)?.[1];
    assert.ok(state);
    result[state === "Z" ? "zombie" : "live"]++;
    if (/^PPid:\s+1\s*$/m.test(status)) result.parent1++;
    const name = /^Name:\s+([^\n]+)$/m.exec(status)?.[1];
    result[["node", "esbuild", "workerd"].includes(name) ? name : "other"]++;
  }
  return result; // no PID, raw Name, command line, path or status text
}
async function quiescent() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { noOtherProcesses(); return; } catch { await delay(50); }
  }
  processSnapshot = summarizeRemainingProcesses();
  throw fixedError("OFFLINE_UNEXPECTED_PROCESS_REMAINS");
}
function compiled(metadata) {
  const provenance = {
    commit: metadata.commit, sourceSha256: metadata.sourceDigest, packageSha256: PACKAGE_SHA256,
    lockSha256: LOCK_SHA256, tests: EXPECTED_TESTS, workerTests: EXPECTED_WORKER_TESTS,
  };
  const archive = collectCompiledArtifact("/scratch/repo/apps/web", provenance, "/source/apps/web/public");
  verifyCompiledArtifact(archive, provenance);
  return archive;
}

async function runStages(transfer) {
  phase = "SOURCE_CLONE";
  const metadata = cloneSource();
  let artifactSha256;
  phase = "TOOLCHAIN_LINK";
  linkPackages();
  const stages = [
    ["typecheck", ["/toolchain/node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]],
    ["lint", ["/toolchain/node_modules/eslint/bin/eslint.js", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next"]],
    ["build", ["/toolchain/node_modules/vinext/dist/cli.js", "build"]],
    ["unit", ["--test", "--test-reporter=spec", "--test-concurrency=1", ...TESTS]],
    ["staging_worker", ["--test", "--test-reporter=spec", "--test-concurrency=1", ...WORKER_TESTS]],
  ];
  for (const [stage, args] of stages) {
    phase = ({ typecheck: "TYPECHECK", lint: "LINT", build: "BUILD", unit: "UNIT", staging_worker: "STAGING_WORKER" })[stage];
    noOtherProcesses();
    preflight("app");
    const result = await bounded("/usr/bin/node", ["--max-old-space-size=1536", ...args], {
      cwd: "/scratch/repo/apps/web", env: APP_ENV, ms: 120_000,
    });
    const summary = summarize(stage, result);
    if (stage === "typecheck" && result.code !== 0) summary.typeDiagnostics = typecheckDiagnostics(result.stdout);
    summaries.push(summary);
    const testFiles = stage === "unit" ? TESTS : stage === "staging_worker" ? WORKER_TESTS : null;
    if (testFiles && !result.limited && !result.signal && !result.error) {
      summary.unitDiagnostics = unitFailureLocations(result.stdout, testFiles);
      const knownCodes = ["ERR_MODULE_NOT_FOUND", "ERR_UNKNOWN_BUILTIN_MODULE", "ERR_UNKNOWN_FILE_EXTENSION", "ERR_UNSUPPORTED_ESM_URL_SCHEME", "ERR_REQUIRE_ESM", "ERR_INVALID_ARG_TYPE", "ERR_ASSERTION", "ENOENT"];
      const output = result.stdout.toString("utf8");
      summary.unitRuntimeErrors = knownCodes.filter((code) => new RegExp(`\\b${code}\\b`).test(output));
      // Observe the footer even on exit1; a failed assertion below still blocks.
      const expectedTests = stage === "unit" ? EXPECTED_TESTS : EXPECTED_WORKER_TESTS;
      summary.tap = verifySpec(result.stdout, expectedTests, (counters) => { summary.tap = counters; });
    }
    if (result.code !== 0 || result.signal || result.error || result.limited) throw fixedError("OFFLINE_STAGE_FAILED_OR_LIMITED");
    // `tap` is the existing protocol field name, not the output formatter.
    phase = "POST_STAGE";
    await quiescent();
    preflight("app"); // also rejects actual cgroup OOM, not just exit codes
    if (transfer && stage === "build") {
      phase = "ARTIFACT";
      artifactSha256 = sha256(compiled(metadata));
    }
  }
  return { metadata, artifactSha256 };
}
async function main() {
  const [action, rawNonce, ...extra] = process.argv.slice(2);
  const nonce = validNonce(rawNonce);
  executionNonce = nonce;
  assert.ok(!extra.length && ["idle", "status", "run", "run-artifact", "export-artifact"].includes(action));
  phase = "PREFLIGHT";
  preflight("app");
  if (action === "idle") {
    assert.equal(process.pid, 1);
    writeFileSync(`${readiness}.pending`, JSON.stringify({ protocol: "offline-consumer-v1", nonce, ready: true }), { flag: "wx", mode: 0o600 });
    renameSync(`${readiness}.pending`, readiness);
    setInterval(() => {}, 1000);
    return;
  }
  phase = "READINESS";
  let state;
  try { state = jsonFile(readiness); }
  catch (error) {
    if (action !== "status" || error.code !== "ENOENT") throw error;
    emit({ protocol: "offline-consumer-v1", nonce, ready: false });
    return;
  }
  assert.deepEqual(state, { protocol: "offline-consumer-v1", nonce, ready: true });
  assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
  if (action === "status") { emit(state); return; }
  noOtherProcesses();
  if (action === "export-artifact") {
    phase = "ARTIFACT";
    assert.equal(readRegular("/scratch/app-started", 4).toString("utf8"), "once");
    const archive = compiled(jsonFile("/metadata/review.json"));
    noOtherProcesses();
    preflight("app");
    await new Promise((resolve, reject) => process.stdout.write(archive, (error) => error ? reject(error) : resolve()));
    return;
  }
  writeFileSync("/scratch/app-started", "once", { flag: "wx", mode: 0o600 });
  const { metadata, artifactSha256 } = await runStages(action === "run-artifact");
  emit({ protocol: "offline-app-v1", nonce, ok: true, commit: metadata.commit, sourceDigest: metadata.sourceDigest, stages: summaries, artifactSha256 });
}
try { await main(); }
catch (error) {
  // Expose fixed trusted control metadata only, never raw exception details.
  const controlPhase = PHASES.has(phase) ? phase : "START";
  const category = ERROR_CLASSES.has(error?.code) ? error.code : "OTHER";
  const failureKind = error?.safeCode === "OFFLINE_UNEXPECTED_PROCESS_REMAINS" ? "UNEXPECTED_PROCESS_REMAINS"
    : error?.safeCode === "OFFLINE_STAGE_FAILED_OR_LIMITED" ? "STAGE_FAILED_OR_LIMITED" : "OTHER";
  const artifactFailure = controlPhase === "ARTIFACT" && ARTIFACT_FAILURES.includes(error?.safeCode) ? error.safeCode : null;
  const artifactPathHints = artifactFailure === "ARTIFACT_PATH_LAYOUT" && Array.isArray(error?.pathHints)
    ? error.pathHints.slice(0, 8).map(stagingArtifactPathHint).filter(Boolean) : [];
  emit({ protocol: "offline-app-v1", nonce: executionNonce, ok: false, controlPhase, category, failureKind, artifactFailure, artifactPathHints, processSnapshot, stages: summaries });
  process.exitCode = 1;
}
