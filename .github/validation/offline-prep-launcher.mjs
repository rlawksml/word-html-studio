// Trusted PID1 installs dependencies as data, then IDLES to keep tmpfs mounted.
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { LOCK_SHA256, PACKAGE_SHA256, PREP_ENV } from "./offline-baseline.mjs";
import { bounded, sha256 } from "./offline-host-support.mjs";
import { emit, jsonFile, noOtherProcesses, preflight, summarize, validNonce } from "./offline-sandbox-common.mjs";

const statePath = "/scratch/prepared.json";
async function main() {
  const [action, rawNonce, ...extra] = process.argv.slice(2);
  const nonce = validNonce(rawNonce);
  assert.ok(!extra.length && ["prepare", "status"].includes(action));
  if (action === "status") {
    // No preflight RW probe while the installer is active. Inspect only trusted
    // state; READY is accepted only after PID1 has no installer/other processes.
    let state;
    try { state = jsonFile(statePath); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      emit({ protocol: "offline-prep-v1", nonce, ready: false, done: false });
      return;
    }
    assert.equal(state.nonce, nonce);
    assert.deepEqual(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
    preflight("prep");
    noOtherProcesses();
    emit(state);
    return;
  }
  assert.equal(process.pid, 1);
  preflight("prep", { preparing: true });
  assert.equal(sha256(readFileSync("/input/package.json")), PACKAGE_SHA256);
  assert.equal(sha256(readFileSync("/input/package-lock.json")), LOCK_SHA256);
  copyFileSync("/input/package.json", "/toolchain/package.json");
  copyFileSync("/input/package-lock.json", "/toolchain/package-lock.json");
  const result = await bounded("/usr/bin/node", ["/usr/lib/npm/bin/npm-cli.js", "ci",
    "--ignore-scripts", "--no-audit", "--no-fund", "--fetch-retries=0",
    "--registry=https://registry.npmjs.org/", "--userconfig=/dev/null", "--globalconfig=/dev/null",
    "--cache=/scratch/npm-cache", "--update-notifier=false"], {
    cwd: "/toolchain", env: PREP_ENV, ms: 180_000,
  });
  // No install-script reactivation, missing-native fallback, npm update, lock
  // upgrade, raw logs or fetching during subsequent offline stages is permitted.
  const summary = summarize("npm_ci_ignore_scripts", result);
  // Polling status processes may briefly coexist with PID1. They are not its
  // children; only the installer/its orphans could keep PID1 children active.
  assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
  assert.equal(sha256(readFileSync("/toolchain/package.json")), PACKAGE_SHA256);
  assert.equal(sha256(readFileSync("/toolchain/package-lock.json")), LOCK_SHA256);
  const ready = result.code === 0 && !result.signal && !result.error && !result.limited;
  preflight("prep");
  writeFileSync(`${statePath}.pending`, JSON.stringify({ protocol: "offline-prep-v1", nonce, done: true, ready, summary }), { flag: "wx", mode: 0o600 });
  renameSync(`${statePath}.pending`, statePath); // publish complete state atomically
  // CRITICAL: exiting here loses the tmpfs at its last mount. The host MUST
  // start + verify the network-none, readonly idle consumer BEFORE removing us.
  setInterval(() => {}, 1000);
}
try { await main(); }
catch { emit({ protocol: "offline-prep-v1", ready: false, done: true, code: "PREP_TRUSTED_PREFLIGHT_OR_STATE_FAILED" }); process.exitCode = 1; }
