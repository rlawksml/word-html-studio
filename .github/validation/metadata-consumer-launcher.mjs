// Read-only, network-none metadata holder/exporter. No npm/app command exists.
import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { LOCK_SHA256, PACKAGE_SHA256 } from "./offline-baseline.mjs";
import { emit, jsonFile, noOtherProcesses, preflight, validNonce } from "./offline-sandbox-common.mjs";
import { validateCandidate, sha256 } from "./metadata-policy.mjs";
import { encodePacket, kindForAction, readManifestFile } from "./metadata-packet.mjs";

const readyPath = "/scratch/metadata-consumer-ready.json";
function candidatePair() {
  const originalPackage = readManifestFile("/input", "package"), originalLock = readManifestFile("/input", "lock");
  assert.equal(sha256(originalPackage), PACKAGE_SHA256);
  assert.equal(sha256(originalLock), LOCK_SHA256);
  const packageBytes = readManifestFile("/toolchain", "package"), lockBytes = readManifestFile("/toolchain", "lock");
  const candidate = validateCandidate(originalPackage, originalLock, packageBytes, lockBytes);
  return { candidate, packageBytes, lockBytes };
}
async function main() {
  const [action, rawNonce, ...extra] = process.argv.slice(2);
  const nonce = validNonce(rawNonce);
  assert.ok(!extra.length && ["idle", "status", "export-package", "export-lock"].includes(action));
  preflight("app");
  if (action === "idle") {
    assert.equal(process.pid, 1);
    // A trusted status probe may coexist while PID1 initializes. Strict
    // quiescence is enforced by status/export after readiness is published.
    assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
    candidatePair();
    writeFileSync(`${readyPath}.pending`, JSON.stringify({ protocol: "metadata-consumer-v1", nonce, ready: true }), { flag: "wx", mode: 0o600 });
    renameSync(`${readyPath}.pending`, readyPath);
    setInterval(() => {}, 1000);
    return;
  }
  let state;
  try { state = jsonFile(readyPath); }
  catch (error) {
    if (action !== "status" || error.code !== "ENOENT") throw error;
    emit({ protocol: "metadata-consumer-v1", nonce, ready: false });
    return;
  }
  assert.deepEqual(state, { protocol: "metadata-consumer-v1", nonce, ready: true });
  assert.equal(readFileSync("/proc/1/task/1/children", "utf8").trim(), "");
  noOtherProcesses();
  if (action === "status") { emit(state); return; }
  const kind = kindForAction(action), pair = candidatePair();
  preflight("app");
  noOtherProcesses();
  process.stdout.write(encodePacket(kind === "package" ? pair.packageBytes : pair.lockBytes, kind, nonce));
}
try { await main(); }
catch { emit({ protocol: "metadata-consumer-v1", ready: false, code: "METADATA_CONSUMER_FAILED" }); process.exitCode = 1; }
