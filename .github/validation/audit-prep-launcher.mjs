// Only trusted npm audit runs here. No install/fix, lifecycle or app command.
// npm may transmit the WHOLE public lock graph plus Node/npm/platform/arch
// metadata, even with --omit=dev. Bridge is NOT a registry-only firewall.
import assert from "node:assert/strict";
import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { PREP_ENV, PACKAGE_SHA256, LOCK_SHA256 } from "./offline-baseline.mjs";
import { bounded } from "./offline-host-support.mjs";
import { emit, jsonFile, noOtherProcesses, validNonce } from "./offline-sandbox-common.mjs";
import { auditPreflight } from "./audit-sandbox-preflight.mjs";
import { AUDIT_WALL_MS, classifyAudit, lockInventory, npmVersion, validateSummary } from "./audit-policy.mjs";
import { readInputPair, readStableFile } from "./audit-file-io.mjs";

const statePath = "/scratch/dependency-audited.json";
function inputEvidence({ sealed = false } = {}) {
  readInputPair(); // descriptor identity/size and pinned SHA-256 rechecked
  assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
  auditPreflight({ sealed });
  return { packageSha256: PACKAGE_SHA256, lockSha256: LOCK_SHA256, children: 0, preflight: true };
}
function version() {
  const value = JSON.parse(readStableFile("/usr/lib/npm/package.json", 65536).toString("utf8"));
  assert.equal(value.name, "npm");
  return npmVersion(value.version);
}
async function main() {
  const [action, rawNonce, ...extra] = process.argv.slice(2);
  const nonce = validNonce(rawNonce);
  assert.ok(!extra.length && ["prepare", "status", "sealed-status"].includes(action));
  if (action !== "prepare") {
    let state;
    try { state = jsonFile(statePath); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      emit({ protocol: "dependency-audit-v1", nonce, done: false });
      return;
    }
    assert.deepEqual(Object.keys(state), ["protocol", "nonce", "done", "summary", "evidence"]);
    assert.equal(state.protocol, "dependency-audit-v1");
    assert.equal(state.nonce, nonce);
    assert.equal(state.done, true);
    validateSummary(state.summary, version());
    assert.deepEqual(state.evidence, inputEvidence({ sealed: action === "sealed-status" }));
    noOtherProcesses();
    emit(state); // only fixed counters/official advisory IDs, never raw audit
    return;
  }
  assert.equal(process.pid, 1);
  auditPreflight({ preparing: true });
  assert.notEqual(PREP_ENV.NPM_CONFIG_USERCONFIG, PREP_ENV.NPM_CONFIG_GLOBALCONFIG);
  for (const path of [PREP_ENV.NPM_CONFIG_USERCONFIG, PREP_ENV.NPM_CONFIG_GLOBALCONFIG]) {
    const info = lstatSync(path);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size === 0 && (info.mode & 0o777) === 0o444);
  }
  const before = readInputPair();
  const inventory = lockInventory(JSON.parse(before.lockBytes.toString("utf8")));
  const npm = version();
  const result = await bounded("/usr/bin/node", ["/usr/lib/npm/bin/npm-cli.js", "audit", "--package-lock-only",
    "--ignore-scripts", "--omit=dev", "--audit-level=high", "--json",
    "--fetch-timeout=30000", "--fetch-retries=0", "--registry=https://registry.npmjs.org/",
    "--userconfig=/trusted/npm-user.conf", "--globalconfig=/trusted/npm-global.conf",
    "--cache=/scratch/npm-cache", "--update-notifier=false"], { cwd: "/input", env: PREP_ENV, ms: AUDIT_WALL_MS });
  const summary = classifyAudit(result, inventory, npm);
  const evidence = inputEvidence();
  const after = readInputPair();
  assert.ok(before.packageBytes.equals(after.packageBytes) && before.lockBytes.equals(after.lockBytes));
  writeFileSync(`${statePath}.pending`, JSON.stringify({ protocol: "dependency-audit-v1", nonce, done: true, summary, evidence }), { flag: "wx", mode: 0o600 });
  renameSync(`${statePath}.pending`, statePath);
  setInterval(() => {}, 1000); // trusted PID1 only; no consumer/app is created
}
try { await main(); }
catch { process.stderr.write("DEPENDENCY_AUDIT_PREP_BLOCKED\n"); process.exitCode = 1; }
