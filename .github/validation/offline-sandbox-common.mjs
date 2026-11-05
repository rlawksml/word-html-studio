// Trusted preflight shared by both image launchers. No app/package imports.
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { APP_ENV, PREP_ENV } from "./offline-baseline.mjs";
import { sha256 } from "./offline-host-support.mjs";

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function validNonce(value) { assert.match(value, /^[a-f0-9]{32}$/); return value; }
export function jsonFile(path) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 16384);
  return JSON.parse(readFileSync(path, "utf8"));
}
export function noOtherProcesses() {
  const processes = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number);
  assert.ok(processes.every((pid) => pid === 1 || pid === process.pid));
}
function mounts() {
  return readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map((line) => {
    const [left, right] = line.split(" - ");
    assert.ok(left && right);
    const fields = left.split(" "), more = right.split(" ");
    return { path: fields[4], flags: new Set(fields[5].split(",")), type: more[0] };
  });
}
export function preflight(role, { preparing = false } = {}) {
  assert.ok(["prep", "app"].includes(role));
  const env = role === "prep" ? PREP_ENV : APP_ENV;
  assert.deepEqual(Object.keys(process.env).sort(), Object.keys(env).sort());
  for (const [name, value] of Object.entries(env)) assert.equal(process.env[name], value);
  assert.equal(process.execPath, "/usr/bin/node");
  assert.equal(process.getuid(), 65534);
  assert.equal(process.getgid(), 65534);
  assert.ok(process.getgroups().every((id) => id === 65534));
  const status = readFileSync("/proc/self/status", "utf8");
  assert.match(status, /^CapEff:\s+0+$/m);
  assert.match(status, /^CapPrm:\s+0+$/m);
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  assert.match(status, /^Seccomp:\s+2$/m);
  const limit = (name) => readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
  assert.equal(limit("memory.max"), String((role === "prep" ? 3 : 2) * 1024 ** 3));
  assert.equal(limit("memory.swap.max"), "0");
  assert.equal(limit("pids.max"), "128");
  const cpu = limit("cpu.max").split(/\s+/).map(Number);
  assert.ok(cpu.length === 2 && cpu.every((value) => Number.isFinite(value) && value > 0) && cpu[0] / cpu[1] <= 2);
  assert.match(limit("memory.events"), /^oom_kill 0$/m);
  const limits = readFileSync("/proc/self/limits", "utf8");
  assert.match(limits, /Max cpu time\s+180\s+180\s+seconds/);
  assert.match(limits, /Max file size\s+268435456\s+268435456\s+bytes/);
  assert.match(limits, /Max open files\s+512\s+512\s+files/);
  assert.match(limits, /Max core file size\s+0\s+0\s+bytes/);
  const table = mounts();
  const containing = (path) => table.filter((mount) => mount.path === "/" || path === mount.path || path.startsWith(`${mount.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  for (const path of ["/", "/usr", "/trusted", "/input", "/source", "/metadata", "/tmp", "/sys", "/sys/fs/cgroup", "/dev/shm", "/dev/pts", "/dev/mqueue"]) {
    const mount = containing(path);
    assert.ok(mount?.flags.has("ro") && !mount.flags.has("rw"));
  }
  for (const [path, size, writable] of [["/scratch", 512 * 1024 ** 2, true], ["/toolchain", 2 * 1024 ** 3, role === "prep"]]) {
    const mount = table.find((entry) => entry.path === path);
    assert.ok(mount && mount.type === "tmpfs" && mount.flags.has("nosuid") && mount.flags.has("nodev"));
    assert.ok(mount.flags.has(writable ? "rw" : "ro") && !mount.flags.has(writable ? "ro" : "rw"));
    const stats = statfsSync(path);
    assert.equal(stats.type, 0x01021994);
    assert.equal(stats.bsize * stats.blocks, size);
    const info = lstatSync(path);
    assert.ok(info.isDirectory() && info.uid === 65534 && info.gid === 65534 && (info.mode & 0o777) === 0o700);
    // The only RW probes are these disposable volume/scratch locations.
    if (writable) {
      const probe = `${path}/.preflight-${process.pid}`;
      writeFileSync(probe, "owned-sandbox", { flag: "wx", mode: 0o600 });
      unlinkSync(probe);
    }
  }
  const interfaces = networkInterfaces();
  if (role === "app") {
    assert.ok(Object.keys(interfaces).every((name) => name === "lo"));
    assert.ok(Object.values(interfaces).flat().every((entry) => entry?.internal === true));
  } else {
    // Prep uses Docker's ordinary bridge, NOT a registry-only egress firewall.
    // Only trusted npm runs here; no app sources, lifecycle scripts or secrets.
    assert.ok(Object.keys(interfaces).every((name) => ["lo", "eth0"].includes(name)));
    if (preparing) assert.ok(interfaces.eth0?.some((entry) => entry.internal === false));
    else if (!interfaces.eth0) assert.ok(Object.values(interfaces).flat().every((entry) => entry?.internal === true));
    assert.deepEqual(readdirSync("/source"), []);
  }
}
export function summarize(stage, result) {
  const output = Buffer.concat([result.stdout, result.stderr]).toString("utf8");
  const warningLines = output.split("\n").filter((line) => /\b(?:warn|warning|warnings)\b/i.test(line)).length;
  let blockedReason = result.reason ?? null;
  if (!blockedReason && /error while loading shared libraries|cannot open shared object file/i.test(output)) blockedReason = "NATIVE_SHARED_LIBRARY_UNAVAILABLE";
  if (!blockedReason && /(?:postinstall|install script|esbuild.*(?:not found|missing)|workerd.*(?:not found|missing))/i.test(output) && result.code !== 0) blockedReason = "INSTALL_SCRIPT_OUTPUT_UNAVAILABLE";
  if (!blockedReason && /(?:spawn.*ENOENT|\/bin\/sh.*not found|bad interpreter)/i.test(output)) blockedReason = "SHELL_OR_NATIVE_EXECUTABLE_UNAVAILABLE";
  return {
    stage, exit: result.code, signal: result.signal, limited: result.limited, error: result.error,
    blockedReason, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length,
    stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr),
    // Observed matching lines, NOT a claim that unmatched warnings do not exist.
    observedWarningLines: warningLines,
  };
}
export function emit(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
