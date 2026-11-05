// Native-only protocol fixtures. Run solely in the reviewed private /scratch
// OS sandbox. No SDK, real repository, host home, credential or network access.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PREFIX = "backup-writer-ledger-v1\n";
const PROTOCOL = "backup-protocol-fixture-v1";
const CAP = 32768;
const PEERS = new Set(["oversize-ack", "hold-put"]);
const CLIENT_MODES = new Set(["success", "duplicate", "bad-path", "after-finish", "cancel-idle", "cancel-pending", "concurrent"]);
export const MARKER = Buffer.from("Backup did not finish. Do not restore it.\n");
export const SENTINEL = Buffer.from("synthetic external bytes — 보존\n");
export const BINARY = Buffer.from([0, 255, 128, 13, 10, 42, 1]);
export const CORE = ["bookstores", "submissions", "editing_leases", "improvement_requests"]
  .map((name) => `database/${name}.json`);
export const REQUIRED = [...CORE, "manifest.json", "README.txt"];
export const OPTIONAL = ["app_schema_versions", "news_schedule_ranges", "monthly_digest_orders"]
  .map((name) => `database/${name}.json`);
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export const entry = (relative, payload) => ({ path: relative, base64: Buffer.from(payload).toString("base64") });
export const baseEntries = () => [
  entry(CORE[0], '[{"id":1,"name":"가짜 책방 📚"}]\n'),
  ...CORE.slice(1).map((relative) => entry(relative, "[]\n")),
  entry("manifest.json", '{"syntheticProtocolFixture":true}\n'),
  entry("README.txt", "프로토콜 fixture만 사용합니다.\n"),
];
const fail = (code) => Object.assign(new Error(code), { code });
const exists = async (target) => {
  try { await lstat(target); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
};

export async function identityDigest(target) {
  const info = await lstat(target, { bigint: true });
  return sha(`${info.dev}:${info.ino}:${info.mode}:${info.nlink}`);
}

export async function snapshot(root) {
  const items = [];
  async function visit(relative) {
    const target = path.join(root, relative), info = await lstat(target);
    const item = { path: relative, mode: info.mode & 0o777, links: info.nlink,
      type: info.isDirectory() ? "dir" : info.isFile() ? "file" : info.isSymbolicLink() ? "link" : "other" };
    if (item.type === "file") { item.size = info.size; item.hash = sha(await readFile(target)); }
    if (item.type === "link") item.target = await readlink(target);
    items.push(item);
    if (item.type === "dir") for (const name of (await readdir(target)).sort()) await visit(path.join(relative, name));
  }
  await visit("");
  return sha(JSON.stringify(items));
}

async function groupGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw fail("PROTOCOL_FIXTURE_GROUP_UNCONFIRMED");
  for (let attempt = 0; attempt < 50; attempt++) {
    try { process.kill(-pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") return;
      throw fail("PROTOCOL_FIXTURE_GROUP_UNCONFIRMED");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw fail("PROTOCOL_FIXTURE_GROUP_UNCONFIRMED");
}

function managed(owner, executable, argv, onOutput) {
  const child = spawn(executable, argv, { cwd: "/", env: {}, shell: false, detached: true,
    stdio: ["pipe", "pipe", "pipe"] });
  const chunks = { stdout: [], stderr: [] };
  let bytes = 0, limited = false, runtimeError = false, closeSeen = false;
  const kill = () => {
    if (!closeSeen && Number.isSafeInteger(child.pid) && child.pid > 1) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* groupGone decides */ }
    }
  };
  const timer = setTimeout(() => { limited = true; kill(); }, 6000);
  const record = { child, kill, done: null, async dispose() {
    if (!closeSeen) { try { child.stdin.end(); } catch { /* close decides */ } }
    await record.done;
  } };
  owner.processes.add(record);
  record.done = new Promise((resolve, reject) => {
    for (const stream of ["stdout", "stderr"]) child[stream].on("data", (part) => {
      bytes += part.length;
      if (bytes > CAP) { limited = true; kill(); return; }
      chunks[stream].push(part);
      try { if (stream === "stdout") onOutput?.(part); }
      catch { runtimeError = true; kill(); }
    });
    child.stdin.on("error", () => { /* malformed/EOF tests may close the peer first */ });
    child.on("error", () => { runtimeError = true; });
    child.on("close", async (code, signal) => {
      closeSeen = true;
      clearTimeout(timer);
      try {
        await groupGone(child.pid);
        assert.ok(!limited && !runtimeError && signal === null && [0, 1].includes(code), "PROTOCOL_FIXTURE_CHILD_LIMIT_OR_RUNTIME");
        resolve({ code, stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr) });
      } catch (error) {
        if (error.code === "PROTOCOL_FIXTURE_GROUP_UNCONFIRMED") owner.safeToRemove = false;
        reject(error.code === "PROTOCOL_FIXTURE_GROUP_UNCONFIRMED" ? error : fail("PROTOCOL_FIXTURE_CHILD_LIMIT_OR_RUNTIME"));
      }
    });
  });
  record.done.catch(() => undefined); // prevent an unobserved internal close rejection
  return record;
}

// These deliberately abnormal peers test the REAL unchanged Node client only.
// They are not substitutes for any real-Python-server filesystem assertion.
function peerSource(mode) {
  assert.ok(PEERS.has(mode), "PROTOCOL_FIXTURE_PEER_NOT_ALLOWLISTED");
  if (mode === "oversize-ack") return [
    "import sys", "sys.stdin.buffer.readline(8193)",
    "sys.stdout.buffer.write(b'x' * 2049)", "sys.stdout.buffer.flush()", "sys.stdin.buffer.read()", "",
  ].join("\n");
  return [
    "import json,os,sys", "request=json.loads(sys.stdin.buffer.readline(8193))",
    "destination=request['destination']",
    "assert destination.startswith('/scratch/bookstore-protocol-owned-')",
    "os.mkdir(destination,0o700)",
    "fd=os.open(destination+'/INCOMPLETE',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)",
    "os.write(fd,b'Backup did not finish. Do not restore it.\\n')", "os.close(fd)",
    "sys.stdout.write(json.dumps({'v':1,'id':1,'ok':True,'op':'init'},separators=(',',':'))+'\\n')",
    "sys.stdout.flush()", "sys.stdin.buffer.read()", "",
  ].join("\n");
}

export async function withProtocolFixture(run, peer = null) {
  assert.equal(process.env.TMPDIR, "/scratch", "PROTOCOL_FIXTURE_OS_SANDBOX_REQUIRED");
  assert.equal((await lstat("/scratch")).mode & 0o777, 0o700, "PROTOCOL_FIXTURE_PRIVATE_SCRATCH_REQUIRED");
  assert.ok(peer === null || PEERS.has(peer), "PROTOCOL_FIXTURE_PEER_NOT_ALLOWLISTED");
  const root = await mkdtemp("/scratch/bookstore-protocol-owned-");
  const owner = { processes: new Set(), safeToRemove: true };
  try {
    await chmod(root, 0o700);
    const repository = path.join(root, "fake-repository"), scripts = path.join(repository, "scripts");
    const parent = path.join(root, "destination"), output = path.join(parent, "run");
    const protectedRoot = path.join(repository, "protected"), protectedFile = path.join(protectedRoot, "bookstore-news-originals/b.bin");
    await mkdir(scripts, { recursive: true, mode: 0o700 });
    await mkdir(parent, { mode: 0o700 });
    await mkdir(path.dirname(protectedFile), { recursive: true, mode: 0o700 });
    await writeFile(protectedFile, SENTINEL, { flag: "wx", mode: 0o600 });
    for (const name of ["backup-writer-client.mjs", "backup-dirfd-writer.py"]) {
      const bytes = await readFile(new URL(`../../scripts/${name}`, import.meta.url));
      const destination = path.join(scripts, name);
      const payload = peer && name.endsWith(".py") ? Buffer.from(peerSource(peer)) : bytes;
      await writeFile(destination, payload, { flag: "wx", mode: 0o600 });
      assert.equal(sha(await readFile(destination)), sha(payload), "PROTOCOL_FIXTURE_SOURCE_BYTE_IDENTITY");
    }
    const fixture = {
      root, repository, output, parent, scripts, protectedRoot, protectedFile,
      externalBefore: await snapshot(protectedRoot),
      async externalDigest() { return snapshot(protectedRoot); },
      async markerPresent() { return exists(path.join(output, "INCOMPLETE")); },
      async fileHash(relative) { return sha(await readFile(path.join(output, relative))); },
      async raw() { assert.equal(peer, null, "PROTOCOL_FIXTURE_REAL_SERVER_REQUIRED"); return rawSession(owner, fixture); },
      async client(mode, entries = baseEntries(), required = REQUIRED) {
        assert.ok(CLIENT_MODES.has(mode), "PROTOCOL_FIXTURE_MODE_NOT_ALLOWLISTED");
        const input = { mode, entries, required, repository, output, client: path.join(scripts, "backup-writer-client.mjs") };
        const record = managed(owner, process.execPath,
          [fileURLToPath(import.meta.url), "--client-child", JSON.stringify(input)]);
        record.child.stdin.end();
        const result = await record.done;
        assert.ok(result.code === 0 && result.stderr.length === 0, "PROTOCOL_FIXTURE_CLIENT_HARNESS_FAILED");
        let summary;
        try { summary = JSON.parse(result.stdout); } catch { throw fail("PROTOCOL_FIXTURE_CONTROL_INVALID"); }
        assert.equal(result.stdout.toString(), `${JSON.stringify(summary)}\n`, "PROTOCOL_FIXTURE_CONTROL_NONCANONICAL");
        assert.deepEqual(Object.keys(summary), ["protocol", "ok", "error", "codes"], "PROTOCOL_FIXTURE_CONTROL_FIELDS");
        assert.ok(summary.protocol === PROTOCOL && typeof summary.ok === "boolean" && Array.isArray(summary.codes), "PROTOCOL_FIXTURE_CONTROL_INVALID");
        for (const code of [summary.error, ...summary.codes]) {
          assert.ok(code === null || (typeof code === "string" && /^BACKUP_WRITER_[A-Z_]{1,48}$/.test(code)), "PROTOCOL_FIXTURE_UNSAFE_ERROR");
        }
        return summary;
      },
    };
    return await run(fixture);
  } finally {
    let failure;
    for (const record of owner.processes) {
      try { await record.dispose(); } catch (error) { failure ??= error; }
    }
    if (owner.safeToRemove) await rm(root, { recursive: true, force: true });
    if (failure) throw failure;
  }
}

async function rawSession(owner, fixture) {
  let buffer = Buffer.alloc(0), waiting = null;
  const received = [];
  const record = managed(owner, "/usr/bin/python3", ["-I", "-S", "-B", path.join(fixture.scripts, "backup-dirfd-writer.py")], (part) => {
    buffer = Buffer.concat([buffer, part]);
    while (buffer.includes(10)) {
      const index = buffer.indexOf(10), line = buffer.subarray(0, index + 1);
      buffer = buffer.subarray(index + 1);
      assert.ok(line.length <= 2048, "PROTOCOL_FIXTURE_ACK_LIMIT");
      const ack = JSON.parse(line);
      assert.equal(line.toString(), `${JSON.stringify(ack)}\n`, "PROTOCOL_FIXTURE_ACK_CANONICAL");
      assert.ok(ack.v === 1 && Number.isSafeInteger(ack.id) && typeof ack.ok === "boolean", "PROTOCOL_FIXTURE_ACK_SCHEMA");
      if (!ack.ok) assert.match(ack.code, /^BACKUP_WRITER_[A-Z_]{1,48}$/);
      if (waiting) { const resolve = waiting.resolve; waiting = null; resolve(ack); }
      else received.push(ack);
    }
    assert.ok(buffer.length <= 2048, "PROTOCOL_FIXTURE_ACK_LIMIT");
  });
  record.done.then(() => {
    if (waiting) { waiting.reject(fail("PROTOCOL_FIXTURE_ACK_MISSING")); waiting = null; }
  }, () => {
    if (waiting) { waiting.reject(fail("PROTOCOL_FIXTURE_CHILD_FAILED")); waiting = null; }
  });
  let id = 0, files = 0, bytes = 0;
  const ledger = createHash("sha256").update(PREFIX), headers = [];
  function nextAck() {
    if (received.length) return Promise.resolve(received.shift());
    assert.equal(waiting, null, "PROTOCOL_FIXTURE_RAW_SERIAL_ONLY");
    return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
  }
  async function request(op, fields, payload, { end = false, tail = Buffer.alloc(0), spaced = false } = {}) {
    const value = { v: 1, id: ++id, op, ...fields };
    const text = JSON.stringify(value);
    const header = Buffer.from(`${spaced ? text.replaceAll(":", ": ") : text}\n`);
    const pending = nextAck();
    const frame = Buffer.concat([header, payload ?? Buffer.alloc(0), tail]);
    if (end) record.child.stdin.end(frame);
    else record.child.stdin.write(frame);
    return { ack: await pending, header, id: value.id };
  }
  const session = {
    request,
    async put(relative, payload, options = {}) {
      const data = Buffer.from(payload);
      const result = await request("put", { path: relative, bytes: options.bytes ?? data.length,
        sha256: options.sha256 ?? sha(data) }, data, options);
      if (result.ack.ok) {
        files++; bytes += data.length; ledger.update(result.header); headers.push(result.header);
        assert.equal(result.ack.id, result.id, "PROTOCOL_FIXTURE_PUT_ID");
        assert.deepEqual([result.ack.files, result.ack.bytes, result.ack.ledger],
          [files, bytes, ledger.copy().digest("hex")], "PROTOCOL_FIXTURE_PUT_LEDGER");
      }
      return result.ack;
    },
    async seed(entries = baseEntries(), spaced = false) {
      for (const item of entries) assert.equal((await session.put(item.path, Buffer.from(item.base64, "base64"), { spaced })).ok, true, "PROTOCOL_FIXTURE_SEED_FAILED");
    },
    async finish(overrides = {}, tail = Buffer.alloc(0)) {
      const expected = { files, bytes, ledger: ledger.copy().digest("hex") };
      const result = await request("finish", { ...expected, required: REQUIRED, ...overrides }, undefined, { end: true, tail });
      if (result.ack.ok) assert.deepEqual([result.ack.files, result.ack.bytes, result.ack.ledger],
        [files, bytes, expected.ledger], "PROTOCOL_FIXTURE_FINISH_LEDGER");
      return result.ack;
    },
    reserializedLedger() {
      const value = createHash("sha256").update(PREFIX);
      for (const header of headers) value.update(`${JSON.stringify(JSON.parse(header))}\n`);
      return value.digest("hex");
    },
    async closed() {
      const value = await record.done;
      assert.equal(value.stderr.length, 0, "PROTOCOL_FIXTURE_SERVER_STDERR");
      assert.equal(buffer.length, 0, "PROTOCOL_FIXTURE_ACK_TRAILING_BYTES");
      return value.code;
    },
  };
  const initialized = await request("init", { repository: fixture.repository, destination: fixture.output });
  assert.equal(initialized.ack.ok, true, "PROTOCOL_FIXTURE_INIT_FAILED");
  assert.deepEqual(initialized.ack, { v: 1, id: 1, ok: true, op: "init" }, "PROTOCOL_FIXTURE_INIT_ACK");
  return session;
}

async function clientChild() {
  const summary = { protocol: PROTOCOL, ok: true, error: null, codes: [] };
  let writer;
  const errorCode = (error) => {
    if (typeof error?.code === "string" && /^BACKUP_WRITER_[A-Z_]{1,48}$/.test(error.code)) return error.code;
    throw fail("PROTOCOL_FIXTURE_UNSAFE_CLIENT_ERROR");
  };
  try {
    const input = JSON.parse(process.argv[3]);
    assert.ok(CLIENT_MODES.has(input.mode), "PROTOCOL_FIXTURE_MODE_NOT_ALLOWLISTED");
    const { createBackupWriter } = await import(pathToFileURL(input.client).href);
    writer = await createBackupWriter({ repositoryRoot: input.repository, destination: input.output });
    if (input.mode === "cancel-idle") {
      await writer.close();
      try { await writer.put("README.txt", "never written"); summary.codes.push(null); }
      catch (error) { summary.codes.push(errorCode(error)); }
    } else if (input.mode === "cancel-pending") {
      const pending = writer.put("README.txt", "pending fixture bytes");
      await Promise.resolve();
      const closing = writer.close();
      const results = await Promise.allSettled([pending, closing]);
      summary.codes = results.map((result) => result.status === "rejected" ? errorCode(result.reason) : null);
    } else if (input.mode === "duplicate" || input.mode === "bad-path") {
      const item = input.entries[0], payload = Buffer.from(item.base64, "base64");
      await writer.put(item.path, payload);
      if (input.mode === "duplicate") await writer.put(item.path, Buffer.from("must not replace"));
    } else {
      if (input.mode === "concurrent") {
        const pending = input.entries.map((item, index) => {
          const payload = Buffer.from(item.base64, "base64"), result = writer.put(item.path, payload);
          if (index === 0) payload.fill(0); // client must snapshot before queueing
          return result;
        });
        const finishing = writer.finish(input.required);
        await Promise.all([...pending, finishing]);
      } else {
        for (const item of input.entries) await writer.put(item.path, Buffer.from(item.base64, "base64"));
        await writer.finish(input.required);
      }
      if (input.mode === "after-finish") {
        const results = await Promise.allSettled([writer.put("README.txt", "late"), writer.finish(input.required)]);
        summary.codes = results.map((result) => result.status === "rejected" ? errorCode(result.reason) : null);
      }
    }
  } catch (error) {
    summary.ok = false;
    try { summary.error = errorCode(error); } catch { process.exitCode = 1; }
  } finally {
    try { await writer?.close(); } catch { process.exitCode = 1; }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }
}

if (process.argv[2] === "--client-child") await clientChild();
