// No application executes in PID1, status, or idle mode. The host invokes run
// only AFTER a verified readonly consumer mount and confirmed prep removal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_ENV, EXPECTED_TESTS, LOCK_SHA256, PACKAGE_SHA256, TESTS } from "./offline-baseline.mjs";
import { bounded, fixedError, sha256 } from "./offline-host-support.mjs";
import { delay, emit, jsonFile, noOtherProcesses, preflight, summarize, validNonce } from "./offline-sandbox-common.mjs";

const summaries = [];
const readiness = "/scratch/consumer-ready.json";
const PHASES = new Set(["START", "PREFLIGHT", "READINESS", "SOURCE_CLONE", "TOOLCHAIN_LINK", "TYPECHECK", "LINT", "BUILD", "UNIT", "POST_STAGE"]);
const ERROR_CLASSES = new Set(["ERR_ASSERTION", "ENOENT", "EACCES", "EPERM", "ENOSPC", "EMFILE"]);
let phase = "START", executionNonce = null;
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
function verifyTap(bytes) {
  const text = bytes.toString("utf8");
  const counters = {};
  for (const name of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...text.matchAll(new RegExp(`^# ${name} (\\d+)$`, "gm"))];
    assert.equal(matches.length, 1);
    counters[name] = Number(matches[0][1]);
  }
  assert.equal(counters.tests, EXPECTED_TESTS);
  assert.equal(counters.pass, EXPECTED_TESTS);
  for (const name of ["fail", "cancelled", "skipped", "todo"]) assert.equal(counters[name], 0);
  assert.ok(!/^not ok(?:\s|$)/m.test(text) && !/^Bail out!/mi.test(text));
  return counters;
}
async function quiescent() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { noOtherProcesses(); return; } catch { await delay(50); }
  }
  throw fixedError("OFFLINE_UNEXPECTED_PROCESS_REMAINS");
}
async function runStages() {
  phase = "SOURCE_CLONE";
  const metadata = cloneSource();
  phase = "TOOLCHAIN_LINK";
  linkPackages();
  const stages = [
    ["typecheck", ["/toolchain/node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]],
    ["lint", ["/toolchain/node_modules/eslint/bin/eslint.js", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next"]],
    ["build", ["/toolchain/node_modules/vinext/dist/cli.js", "build"]],
    ["unit", ["--test", "--test-reporter=tap", "--test-concurrency=1", ...TESTS]],
  ];
  for (const [stage, args] of stages) {
    phase = ({ typecheck: "TYPECHECK", lint: "LINT", build: "BUILD", unit: "UNIT" })[stage];
    noOtherProcesses();
    preflight("app");
    const result = await bounded("/usr/bin/node", ["--max-old-space-size=1536", ...args], {
      cwd: "/scratch/repo/apps/web", env: APP_ENV, ms: 120_000,
    });
    const summary = summarize(stage, result);
    if (stage === "typecheck" && result.code !== 0) summary.typeDiagnostics = typecheckDiagnostics(result.stdout);
    summaries.push(summary);
    if (result.code !== 0 || result.signal || result.error || result.limited) throw fixedError("OFFLINE_STAGE_FAILED_OR_LIMITED");
    phase = "POST_STAGE";
    await quiescent();
    preflight("app"); // also rejects actual cgroup OOM, not just exit codes
    if (stage === "unit") summary.tap = verifyTap(result.stdout);
  }
  return metadata;
}
async function main() {
  const [action, rawNonce, ...extra] = process.argv.slice(2);
  const nonce = validNonce(rawNonce);
  executionNonce = nonce;
  assert.ok(!extra.length && ["idle", "status", "run"].includes(action));
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
  writeFileSync("/scratch/app-started", "once", { flag: "wx", mode: 0o600 });
  const metadata = await runStages();
  emit({ protocol: "offline-app-v1", nonce, ok: true, commit: metadata.commit, sourceDigest: metadata.sourceDigest, stages: summaries });
}
try { await main(); }
catch (error) {
  // Expose fixed trusted control metadata only, never raw exception details.
  const controlPhase = PHASES.has(phase) ? phase : "START";
  const category = ERROR_CLASSES.has(error?.code) ? error.code : "OTHER";
  emit({ protocol: "offline-app-v1", nonce: executionNonce, ok: false, controlPhase, category, stages: summaries });
  process.exitCode = 1;
}
