// Run only through the reviewed source-policy container, never on the host.
// These are actual small FD/pipe/process checks, not npm/registry/audit tests.
// They do NOT reproduce identity races, a full 90s audit, OOM, Docker cleanup
// faults, arbitrary descendants, or safety of a shared backup/Storage path.
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync,
  rmSync, statfsSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { readStableFile } from "./audit-file-io.mjs";
import { bounded } from "./offline-host-support.mjs";

// The parent launcher checks the complete network/mount/cgroup/rlimit policy
// before loading this file. Refuse the common accidental host invocation too.
assert.equal(process.platform, "linux");
assert.equal(process.execPath, "/usr/bin/node");
assert.equal(process.getuid(), 65534);
assert.equal(process.cwd(), "/work");
assert.equal(tmpdir(), "/scratch");
assert.equal(realpathSync("/scratch"), "/scratch");
assert.equal(statfsSync("/scratch").type, 0x01021994);

const CAPTURE_LIMIT = 65536; // existing bounded() shared stdout + stderr cap
const CHILD_ARGS = ["--no-addons", "--max-old-space-size=32", "-e"];
async function ownedScratch(check) {
  const directory = mkdtempSync("/scratch/audit-runtime-");
  assert.equal(dirname(directory), "/scratch");
  const identity = lstatSync(directory, { bigint: true });
  try { return await check(directory); }
  finally {
    const current = lstatSync(directory, { bigint: true });
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev);
    assert.equal(current.ino, identity.ino);
    // Exactly this invocation's mkdtemp, not a caller path or broad cleanup.
    // No adversarial parent-directory replacement race is claimed here.
    rmSync(directory, { recursive: true });
    assert.equal(existsSync(directory), false);
  }
}
const child = (script, cwd, options = {}) => bounded("/usr/bin/node", [...CHILD_ARGS, script], {
  cwd, env: {}, ms: 3000, ...options,
});

test("AUDIT-RUNTIME-01 regular single-link file returns its exact bytes at the bound", async () => {
  await ownedScratch((directory) => {
    const path = join(directory, "fixture.bin");
    const bytes = Buffer.from([0x00, 0x31, 0x7f, 0xff]);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    assert.equal(lstatSync(path).nlink, 1);
    assert.deepEqual(readStableFile(path, bytes.length), bytes);
  });
});

test("AUDIT-RUNTIME-02 symlink leaf is rejected without changing its target", async () => {
  await ownedScratch((directory) => {
    const target = join(directory, "target.bin"), link = join(directory, "link.bin");
    const bytes = Buffer.from("owned-target");
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    symlinkSync("target.bin", link);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.throws(() => readStableFile(link, 128));
    assert.deepEqual(readStableFile(target, 128), bytes);
  });
});

test("AUDIT-RUNTIME-03 hard-linked file is rejected for both names", async () => {
  await ownedScratch((directory) => {
    const original = join(directory, "original.bin"), alias = join(directory, "alias.bin");
    writeFileSync(original, "owned-hardlink", { flag: "wx", mode: 0o600 });
    linkSync(original, alias);
    assert.equal(lstatSync(original).nlink, 2);
    assert.throws(() => readStableFile(original, 128));
    assert.throws(() => readStableFile(alias, 128));
    assert.ok(existsSync(original) && existsSync(alias));
  });
});

test("AUDIT-RUNTIME-04 directory, empty and over-bound files are rejected", async () => {
  await ownedScratch((directory) => {
    const folder = join(directory, "folder"), empty = join(directory, "empty.bin"), large = join(directory, "large.bin");
    mkdirSync(folder);
    writeFileSync(empty, "", { flag: "wx", mode: 0o600 });
    writeFileSync(large, "1234", { flag: "wx", mode: 0o600 });
    assert.throws(() => readStableFile(folder, 128));
    assert.throws(() => readStableFile(empty, 128));
    assert.throws(() => readStableFile(large, 3));
    assert.equal(lstatSync(empty).size, 0);
    assert.deepEqual(readStableFile(large, 4), Buffer.from("1234"));
  });
});

test("AUDIT-RUNTIME-05 fixed trusted Node command receives an empty environment", async () => {
  await ownedScratch(async (directory) => {
    const result = await child(
      'if(Object.keys(process.env).length)process.exit(71);process.stdout.write("owned-out");process.stderr.write("owned-err");',
      directory,
    );
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.error, false);
    assert.equal(result.limited, false);
    assert.equal(result.reason, null);
    assert.equal(result.stdout.toString("utf8"), "owned-out");
    assert.equal(result.stderr.toString("utf8"), "owned-err");
  });
});

test("AUDIT-RUNTIME-06 actual combined output overflow kills the owned command", async () => {
  await ownedScratch(async (directory) => {
    // Each stream alone is below 64KiB; together they exceed the shared cap.
    // Keep the child alive so the observed signal cannot be a normal exit.
    const result = await child(
      'process.stdout.write(Buffer.alloc(40000,97));process.stderr.write(Buffer.alloc(40000,98));setInterval(()=>{},1000);',
      directory,
    );
    assert.equal(result.limited, true);
    assert.equal(result.reason, "OUTPUT_CAP");
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.code, null);
    assert.equal(result.error, false);
    assert.ok(result.stdout.length + result.stderr.length <= CAPTURE_LIMIT);
  });
});

test("AUDIT-RUNTIME-07 actual short wall timeout kills the started owned command", async () => {
  await ownedScratch(async (directory) => {
    const result = await child(
      'process.stdout.write("AUDIT_RUNTIME_READY\\n");setInterval(()=>{},1000);',
      directory, { ms: 1000 },
    );
    assert.equal(result.stdout.toString("utf8"), "AUDIT_RUNTIME_READY\n");
    assert.equal(result.limited, true);
    assert.equal(result.reason, "TIMEOUT");
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.code, null);
    assert.equal(result.error, false);
    assert.equal(result.stderr.length, 0);
  });
});

test("AUDIT-RUNTIME-08 pre-aborted signal does not run the sentinel command", async () => {
  await ownedScratch(async (directory) => {
    const abort = new AbortController();
    abort.abort();
    const result = await child(
      'require("node:fs").writeFileSync("unexpected-child.bin","owned-sentinel",{flag:"wx"});',
      directory, { signal: abort.signal },
    );
    assert.equal(result.code, null);
    assert.equal(result.signal, null);
    assert.equal(result.error, false);
    assert.equal(result.limited, true);
    assert.equal(result.reason, "ABORTED");
    assert.equal(result.stdout.length + result.stderr.length, 0);
    assert.equal(existsSync(join(directory, "unexpected-child.bin")), false);
  });
});
