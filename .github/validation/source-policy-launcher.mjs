// Parent-reviewed sandbox preflight. No checkout module is imported here.
import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";

const reviewedBackupWriterSuites = [
  ["tests/backup-writer-paths.test.mjs", "tests/backup-source-guard.test.mjs"],
  ["tests/backup-writer-protocol.test.mjs"],
];
const reviewedSuites = [
  ["tests/schema-marker-restore-policy.test.mjs", "tests/backup-safety.test.mjs"],
  ["tests/image-retention-policy.test.mjs"],
  ["tests/staging-gate.test.mjs", "tests/supabase-cleanup-guard.test.mjs", "tests/integration-safety-block.test.mjs"],
  ["tests/test-owned-ledger.test.mjs", "tests/fixture-response-observer.test.mjs"],
  ["tests/publication-month.test.mjs"],
  ["tests/backup-completeness.test.mjs"],
  ...reviewedBackupWriterSuites,
];
const allowedTests = process.argv.slice(2);
const matchesSuite = (suite) => JSON.stringify(suite) === JSON.stringify(allowedTests);
const backupWriterSuite = reviewedBackupWriterSuites.some(matchesSuite);
const allowedEnvironment = ["HOME", "PATH", "TMPDIR", "TZ", "UV_THREADPOOL_SIZE", "XDG_CACHE_HOME"];
function fail(code) { console.error(code); process.exit(1); }
try {
  assert.ok(reviewedSuites.some(matchesSuite));
  assert.deepEqual(Object.keys(process.env).sort(), allowedEnvironment);
  assert.equal(process.env.HOME, "/scratch");
  assert.equal(process.env.TMPDIR, "/scratch");
  assert.equal(process.env.XDG_CACHE_HOME, "/scratch");
  assert.equal(process.env.PATH, "/usr/bin:/bin");
  assert.equal(process.env.TZ, "UTC");
  assert.equal(process.env.UV_THREADPOOL_SIZE, "2");
  assert.equal(process.getuid(), 65534);
  assert.equal(process.getgid(), 65534);

  const readLimit = (name) => readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
  assert.equal(readLimit("memory.max"), "268435456");
  assert.equal(readLimit("memory.swap.max"), "0");
  assert.equal(readLimit("pids.max"), "32");
  const cpu = readLimit("cpu.max").split(/\s+/).map(Number);
  assert.ok(cpu.length === 2 && cpu.every((value) => Number.isFinite(value) && value > 0) && cpu[0] / cpu[1] <= 1);
  const limits = readFileSync("/proc/self/limits", "utf8");
  assert.match(limits, /Max cpu time\s+30\s+30\s+seconds/);
  assert.match(limits, /Max file size\s+8388608\s+8388608\s+bytes/);
  assert.match(limits, /Max open files\s+128\s+128\s+files/);
  assert.match(limits, /Max core file size\s+0\s+0\s+bytes/);
  const scratch = statfsSync("/scratch");
  assert.equal(scratch.type, 0x01021994); // TMPFS_MAGIC; no host filesystem bind.
  assert.ok(scratch.bsize * scratch.blocks > 0 && scratch.bsize * scratch.blocks <= 16 * 1024 * 1024);
  const interfaces = networkInterfaces();
  assert.ok(Object.keys(interfaces).every((name) => name === "lo"));
  assert.ok(Object.values(interfaces).flat().every((entry) => entry?.internal === true));
  if (backupWriterSuite) {
    const info = lstatSync("/scratch");
    assert.ok(info.uid === 65534 && info.gid === 65534 && (info.mode & 0o777) === 0o700);
    const status = readFileSync("/proc/self/status", "utf8");
    assert.match(status, /^CapEff:\s+0+$/m);
    assert.match(status, /^NoNewPrivs:\s+1$/m);
    assert.match(status, /^Seccomp:\s+2$/m);
    assert.match(readLimit("memory.events"), /^oom_kill 0$/m);
  }

  // Probe only this disposable container. Never write a host/source worktree.
  const probe = `.source-policy-probe-${process.pid}`;
  for (const directory of ["/", "/work", "/work/scripts", "/work/tests", "/usr/bin", "/tmp", "/dev", "/dev/shm", "/dev/pts", "/dev/mqueue", "/proc", "/sys"]) {
    let blocked = false;
    try { writeFileSync(`${directory}/${probe}`, "probe", { flag: "wx", mode: 0o600 }); }
    catch (error) { blocked = ["EROFS", "EACCES", "EPERM", "ENOENT", "ENOTDIR"].includes(error?.code); }
    assert.ok(blocked);
  }
  writeFileSync(`/scratch/${probe}`, "scratch-only", { flag: "wx", mode: 0o600 });
  console.log("SOURCE_SANDBOX_PREFLIGHT_PASS");
} catch { fail("SOURCE_SANDBOX_PREFLIGHT_FAILED"); }

// The reviewed test process starts only after runtime controls are confirmed.
const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--test", "--test-reporter=tap", "--test-isolation=none", ...allowedTests], {
  env: Object.fromEntries(allowedEnvironment.map((name) => [name, process.env[name]])),
  cwd: "/work", encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
});
if (result.error || result.signal) fail("SOURCE_TEST_PROCESS_FAILED_OR_LIMITED");
if (backupWriterSuite) {
  // No helper or fixture process may remain before any PASS is accepted.
  const pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  if (pids.some((pid) => Number(pid) !== process.pid)) fail("SOURCE_HELPER_PROCESS_REMAINS");
  if (!/^oom_kill 0$/m.test(readFileSync("/sys/fs/cgroup/memory.events", "utf8"))) fail("SOURCE_OOM_OBSERVED");
}
// Raw TAP is only a bounded pipe to the parent; it is not published as an artifact.
process.stdout.write(result.stdout || "");
if (result.stderr) console.error("SOURCE_TEST_STDERR_PRESENT");
process.exit(result.status === 0 && !result.stderr ? 0 : 1);
