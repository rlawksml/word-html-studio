// Trusted PID1 resolves public metadata as data; no lifecycle/app code runs.
import assert from "node:assert/strict";
import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { LOCK_SHA256, PACKAGE_SHA256, PREP_ENV } from "./offline-baseline.mjs";
import { bounded, sha256 } from "./offline-host-support.mjs";
import { emit, jsonFile, noOtherProcesses, preflight, summarize, validNonce } from "./offline-sandbox-common.mjs";
import { nextManifest, parseMetadata, validateCandidate } from "./metadata-policy.mjs";
import { readManifestFile } from "./metadata-packet.mjs";

const statePath = "/scratch/metadata-prepared.json";
async function main() {
  const [action, rawNonce, ...extra] = process.argv.slice(2);
  const nonce = validNonce(rawNonce);
  assert.ok(!extra.length && ["prepare", "status"].includes(action));
  if (action === "status") {
    let state;
    try { state = jsonFile(statePath); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      emit({ protocol: "metadata-prep-v1", nonce, ready: false, done: false });
      return;
    }
    assert.equal(state.nonce, nonce);
    assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
    preflight("prep");
    noOtherProcesses();
    emit(state);
    return;
  }
  assert.equal(process.pid, 1);
  preflight("prep", { preparing: true });
  for (const path of [PREP_ENV.NPM_CONFIG_USERCONFIG, PREP_ENV.NPM_CONFIG_GLOBALCONFIG]) {
    const info = lstatSync(path);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size === 0 && (info.mode & 0o777) === 0o444);
  }
  assert.notEqual(PREP_ENV.NPM_CONFIG_USERCONFIG, PREP_ENV.NPM_CONFIG_GLOBALCONFIG);
  const originalPackage = readManifestFile("/input", "package"), originalLock = readManifestFile("/input", "lock");
  assert.equal(sha256(originalPackage), PACKAGE_SHA256);
  assert.equal(sha256(originalLock), LOCK_SHA256);
  const manifest = nextManifest(parseMetadata(originalPackage, "package"));
  writeFileSync("/toolchain/package.json", `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  writeFileSync("/toolchain/package-lock.json", originalLock, { flag: "wx", mode: 0o600 });
  const result = await bounded("/usr/bin/node", ["/usr/lib/npm/bin/npm-cli.js", "install", "--package-lock-only",
    "--ignore-scripts", "--no-audit", "--no-fund", "--fetch-retries=0", "--registry=https://registry.npmjs.org/",
    "--userconfig=/trusted/npm-user.conf", "--globalconfig=/trusted/npm-global.conf",
    "--cache=/scratch/npm-cache", "--update-notifier=false"], { cwd: "/toolchain", env: PREP_ENV, ms: 180_000 });
  const summary = summarize("npm_lock_only", result);
  assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
  const ready = result.code === 0 && !result.signal && !result.error && !result.limited;
  let candidate = null;
  if (ready) candidate = validateCandidate(originalPackage, originalLock,
    readManifestFile("/toolchain", "package"), readManifestFile("/toolchain", "lock"));
  preflight("prep");
  writeFileSync(`${statePath}.pending`, JSON.stringify({ protocol: "metadata-prep-v1", nonce, done: true, ready, summary, candidate }), { flag: "wx", mode: 0o600 });
  renameSync(`${statePath}.pending`, statePath);
  setInterval(() => {}, 1000); // hold tmpfs until verified RO consumer exists
}
try { await main(); }
catch { emit({ protocol: "metadata-prep-v1", ready: false, done: true, code: "METADATA_PREP_FAILED" }); process.exitCode = 1; }
