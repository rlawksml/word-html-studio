// Audit-specific effective OS controls. Node/npm/input/toolchain stay RO;
// only disposable /scratch is probed for writes. No app/package imports.
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { PREP_ENV } from "./offline-baseline.mjs";

function mounts() {
  return readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map((line) => {
    const [left, right] = line.split(" - ");
    assert.ok(left && right);
    const fields = left.split(" "), more = right.split(" ");
    return { path: fields[4], flags: new Set(fields[5].split(",")), type: more[0] };
  });
}
export function auditPreflight({ preparing = false, sealed = false } = {}) {
  assert.equal(typeof preparing, "boolean");
  assert.equal(typeof sealed, "boolean");
  assert.ok(!(preparing && sealed));
  assert.deepEqual(Object.keys(process.env).sort(), Object.keys(PREP_ENV).sort());
  for (const [name, value] of Object.entries(PREP_ENV)) assert.equal(process.env[name], value);
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
  assert.equal(limit("memory.max"), String(3 * 1024 ** 3));
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
  for (const path of ["/", "/usr", "/trusted", "/input", "/source", "/toolchain", "/metadata", "/tmp", "/sys", "/sys/fs/cgroup", "/dev/shm", "/dev/pts", "/dev/mqueue"]) {
    const mount = containing(path);
    assert.ok(mount?.flags.has("ro") && !mount.flags.has("rw"));
  }
  // This directory comes from the image, not any tmpfs/volume/bind mount.
  assert.equal(table.some((mount) => mount.path === "/toolchain"), false);
  const toolchain = lstatSync("/toolchain");
  assert.ok(toolchain.isDirectory() && !toolchain.isSymbolicLink() && toolchain.uid === 0 && toolchain.gid === 0 && (toolchain.mode & 0o777) === 0o755);
  assert.deepEqual(readdirSync("/toolchain"), []);
  assert.deepEqual(readdirSync("/source"), []);
  const scratch = table.find((entry) => entry.path === "/scratch");
  assert.ok(scratch && scratch.type === "tmpfs" && scratch.flags.has("nosuid") && scratch.flags.has("nodev"));
  assert.ok(scratch.flags.has("rw") && !scratch.flags.has("ro"));
  const stats = statfsSync("/scratch");
  assert.equal(stats.type, 0x01021994);
  assert.equal(stats.bsize * stats.blocks, 512 * 1024 ** 2);
  const info = lstatSync("/scratch");
  assert.ok(info.isDirectory() && info.uid === 65534 && info.gid === 65534 && (info.mode & 0o777) === 0o700);
  const probe = `/scratch/.preflight-${process.pid}`;
  writeFileSync(probe, "owned-sandbox", { flag: "wx", mode: 0o600 });
  unlinkSync(probe);
  // Ordinary bridge, not a registry-only egress firewall. Sealed final status
  // permits loopback only; the host independently confirms disconnection.
  const interfaces = networkInterfaces();
  assert.ok(Object.keys(interfaces).every((name) => ["lo", "eth0"].includes(name)));
  if (sealed) {
    assert.ok(Object.keys(interfaces).every((name) => name === "lo"));
    assert.ok(Object.values(interfaces).flat().every((entry) => entry?.internal === true));
  } else if (preparing) assert.ok(interfaces.eth0?.some((entry) => entry.internal === false));
}
