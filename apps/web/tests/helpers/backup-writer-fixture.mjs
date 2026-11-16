// Actual CLI, synthetic SDK and disposable paths only. Execute solely inside
// the reviewed source-policy OS sandbox; this helper never reads env files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync, constants, mkdirSync, openSync, readSync, renameSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  chmod, lstat, link, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile,
} from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED = [
  "supabase-backup.mjs", "backup-utils.mjs", "backup-manifest-policy.mjs", "supabase-schema.mjs",
];
const OPTIONAL = ["backup-writer-client.mjs", "backup-dirfd-writer.py", "backup-source-guard.mjs"];
const MODES = new Set([
  "normal", "ancestor", "world", "group", "missing", "rename", "collision",
  "hardlink", "fifo", "sdk-error", "missing-env", "existing-dir", "existing-file", "repository",
]);
const PROTOCOL = "backup-writer-fixture-v1";
const CHILD_LIMIT = 32768;
const DUMMY_URL = "https://fixture-source.supabase.co";
const DUMMY_KEY = "synthetic-not-a-real-supabase-key";
const DUMMY_TIME = "2026-01-01T00:00:00.000Z";
export const IMAGE_PATH = "fixture-photo.bin";
export const PHOTO_BYTES = Buffer.from([0, 255, 1, 128, 10, 13, 42]);
export const SENTINEL_BYTES = Buffer.from("synthetic protected sentinel: 보존\n");
export const digest = (value) => createHash("sha256").update(value).digest("hex");
const nativeEnv = (root) => ({ PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, TZ: "UTC" });

async function present(target) {
  try { await lstat(target); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Excludes atime, since checking bytes is itself a read. No symlink is followed
// and FIFO/device contents are never opened by this snapshotter.
export async function treeDigest(root) {
  const records = [];
  async function visit(relative) {
    const target = path.join(root, relative), info = await lstat(target);
    const type = info.isDirectory() ? "directory" : info.isFile() ? "file"
      : info.isSymbolicLink() ? "symlink" : info.isFIFO() ? "fifo" : "other";
    const item = { path: relative, type, mode: info.mode & 0o777, links: info.nlink };
    if (type === "file") { item.bytes = info.size; item.sha256 = digest(await readFile(target)); }
    if (type === "symlink") item.link = await readlink(target);
    records.push(item);
    if (type === "directory") {
      for (const name of (await readdir(target)).sort()) await visit(path.join(relative, name));
    }
  }
  await visit("");
  return digest(JSON.stringify(records));
}

async function copyCli(root) {
  const scripts = path.join(root, "apps/web/scripts");
  await mkdir(scripts, { recursive: true, mode: 0o700 });
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const source = new URL(`../../scripts/${name}`, import.meta.url);
    let bytes;
    try { bytes = await readFile(source); }
    catch (error) {
      if (OPTIONAL.includes(name) && error.code === "ENOENT") continue;
      throw new Error("FIXTURE_SOURCE_COPY_UNAVAILABLE");
    }
    const destination = path.join(scripts, name);
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    assert.equal(digest(await readFile(destination)), digest(bytes), "FIXTURE_SOURCE_BYTE_IDENTITY");
  }
  const migrations = path.join(root, "apps/web/supabase/migrations");
  await mkdir(migrations, { recursive: true, mode: 0o700 });
  await writeFile(path.join(migrations, "202601010001_fixture.sql"), "-- synthetic migration only\n", { flag: "wx", mode: 0o600 });
}

// Every path, including the deliberately hostile "external" repository, is a
// child of this invocation's new /scratch directory. Never use a caller path.
export async function withWriterFixture(mode, run) {
  assert.ok(MODES.has(mode), "FIXTURE_MODE_NOT_ALLOWLISTED");
  assert.equal(process.env.TMPDIR, "/scratch", "FIXTURE_OS_SANDBOX_REQUIRED");
  const scratch = await lstat("/scratch");
  assert.ok(scratch.isDirectory() && (scratch.mode & 0o777) === 0o700, "FIXTURE_PRIVATE_SCRATCH_REQUIRED");
  const root = await mkdtemp("/scratch/bookstore-writer-owned-");
  let fifoFd = null;
  let safeToRemoveFixture = true;
  try {
    await chmod(root, 0o700);
    const repository = path.join(root, "fake-repository"), parent = path.join(root, "destination");
    const output = path.join(parent, "run"), displaced = path.join(root, "displaced-destination");
    const sentinel = path.join(repository, "run/database/bookstores.json");
    const staged = path.join(root, "staged-leaf");
    await copyCli(repository);
    await mkdir(path.dirname(sentinel), { recursive: true, mode: 0o700 });
    await writeFile(sentinel, SENTINEL_BYTES, { flag: "wx", mode: 0o600 });
    await mkdir(parent, { mode: 0o700 });
    let requested = output;
    if (mode === "ancestor") {
      requested = path.join(root, "ancestor-link/new-run");
      await symlink(repository, path.dirname(requested), "dir");
    }
    if (mode === "world") await chmod(parent, 0o777);
    if (mode === "group") await chmod(parent, 0o770);
    if (mode === "missing") requested = path.join(root, "missing-parent/run");
    if (mode === "repository") requested = path.join(repository, "forbidden-new-backup");
    if (mode === "existing-dir") {
      await mkdir(output, { mode: 0o700 });
      await writeFile(path.join(output, "existing-sentinel.txt"), SENTINEL_BYTES, { flag: "wx", mode: 0o600 });
    }
    if (mode === "existing-file") await writeFile(output, SENTINEL_BYTES, { flag: "wx", mode: 0o600 });
    if (mode === "collision") await writeFile(staged, SENTINEL_BYTES, { flag: "wx", mode: 0o600 });
    if (mode === "hardlink") await link(sentinel, staged); // stage before the external snapshot
    if (mode === "fifo") {
      const made = spawnSync("/usr/bin/python3", ["-I", "-S", "-B", "-c",
        "import os,sys; os.mkfifo(sys.argv[1], 0o600)", staged], {
        env: nativeEnv(root), encoding: "utf8", timeout: 2000, maxBuffer: 1024,
      });
      assert.ok(!made.error && !made.signal && made.status === 0 && !made.stdout && !made.stderr, "FIXTURE_FIFO_RUNTIME_UNAVAILABLE");
      // A real reader makes the legacy writer deterministic, not a FIFO hang.
      fifoFd = openSync(staged, constants.O_RDWR | constants.O_NONBLOCK);
    }
    const fixture = {
      root, repository, parent, output, requested, displaced, sentinel, staged, mode,
      externalBefore: await treeDigest(repository),
      async externalDigest() { return treeDigest(repository); },
      async exists(relative, base = output) { return present(path.join(base, relative)); },
      async fileHash(relative, base = output) { return digest(await readFile(path.join(base, relative))); },
      async manifest() { return JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8")); },
      fifoBytes() {
        const buffer = Buffer.alloc(4096);
        try { return readSync(fifoFd, buffer, 0, buffer.length, null); }
        catch (error) { if (error.code === "EAGAIN") return 0; throw new Error("FIXTURE_FIFO_READ_FAILED"); }
      },
      async execute() {
        try { return await runChild({ root, repository, parent, output, requested, displaced, sentinel, staged, mode }); }
        catch (error) { if (error.code === "FIXTURE_GROUP_NOT_QUIESCENT") safeToRemoveFixture = false; throw error; }
      },
    };
    return await run(fixture);
  } finally {
    if (fifoFd !== null) closeSync(fifoFd);
    // root is the exact mkdtemp result above, never an argument or cloud path.
    if (safeToRemoveFixture) await rm(root, { recursive: true, force: true });
  }
}

async function ownedGroupGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    const error = new Error("FIXTURE_GROUP_NOT_QUIESCENT"); error.code = "FIXTURE_GROUP_NOT_QUIESCENT"; throw error;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    try { process.kill(-pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") return true;
      const failure = new Error("FIXTURE_GROUP_NOT_QUIESCENT"); failure.code = "FIXTURE_GROUP_NOT_QUIESCENT"; throw failure;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function runChild(input) {
  const env = nativeEnv(input.root);
  if (input.mode !== "missing-env") Object.assign(env, {
    SUPABASE_URL: DUMMY_URL, SUPABASE_SECRET_KEY: DUMMY_KEY,
    BACKUP_EXPECTED_SOURCE_PROJECT_REF: "fixture-source", BACKUP_CONFIRM_IDLE_WINDOW: "confirmed",
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--fixture-child", JSON.stringify(input)], {
      cwd: input.root, env, detached: true, stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    let total = 0, limited = false, failed = false;
    const stdout = [], stderr = [], control = [];
    const stop = () => { limited = true; if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* close is authoritative */ } } };
    const timer = setTimeout(stop, 4000);
    const capture = (destination) => (part) => {
      total += part.length;
      if (total > CHILD_LIMIT) stop();
      else destination.push(part);
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.stdio[3].on("data", capture(control));
    child.on("error", () => { failed = true; });
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      try {
        if (!(await ownedGroupGone(child.pid))) {
          const failure = new Error("FIXTURE_GROUP_NOT_QUIESCENT");
          failure.code = "FIXTURE_GROUP_NOT_QUIESCENT";
          throw failure;
        }
        assert.ok(!limited && !failed && signal === null && [0, 1].includes(code), "FIXTURE_CHILD_LIMIT_OR_RUNTIME_FAILURE");
        const raw = Buffer.concat(control).toString("utf8"), state = JSON.parse(raw);
        assert.equal(raw, `${JSON.stringify(state)}\n`, "FIXTURE_CONTROL_NONCANONICAL");
        assert.deepEqual(Object.keys(state), ["protocol", "sdkCalled", "dummyCredentials", "barrierRan", "fixtureError"], "FIXTURE_CONTROL_FIELDS");
        assert.equal(state.protocol, PROTOCOL, "FIXTURE_CONTROL_PROTOCOL");
        assert.ok([state.sdkCalled, state.dummyCredentials, state.barrierRan].every((value) => typeof value === "boolean"), "FIXTURE_CONTROL_TYPES");
        assert.equal(state.fixtureError, false, "FIXTURE_SETUP_FAILED");
        let complete = false;
        if (Buffer.concat(stdout).length > 0) {
          const report = JSON.parse(Buffer.concat(stdout).toString("utf8"));
          complete = report.status === "COMPLETE";
        }
        resolve({ code, complete, ...state, stdoutBytes: Buffer.concat(stdout).length, stderrBytes: Buffer.concat(stderr).length });
      } catch (error) {
        if (error.code === "FIXTURE_GROUP_NOT_QUIESCENT") reject(error);
        else reject(new Error("FIXTURE_CHILD_CONTROL_OR_RUNTIME_FAILURE"));
      }
    });
  });
}

function syntheticClient(input, state) {
  state.sdkCalled = true;
  const databaseLeaf = path.join(input.output, "database/bookstores.json");
  if (input.mode === "sdk-error") throw new Error("FIXTURE_EXPECTED_SDK_FAILURE");
  if (input.mode === "rename") {
    renameSync(input.parent, input.displaced);
    symlinkSync(input.repository, input.parent, "dir");
    state.barrierRan = true;
  }
  if (["collision", "hardlink", "fifo"].includes(input.mode)) {
    mkdirSync(path.dirname(databaseLeaf), { mode: 0o700 });
    renameSync(input.staged, databaseLeaf);
    state.barrierRan = true;
  }
  const rows = {
    bookstores: [{ id: 1, name: "가짜 책방 — 한글과 📚" }],
    submissions: [{ id: 2, news: [{ id: 3, title: "한글 본문\n둘째 줄", images: [{
      id: 4, originalPath: IMAGE_PATH, previewPath: IMAGE_PATH,
    }] }] }], editing_leases: [], improvement_requests: [],
  };
  return {
    from(table) {
      assert.ok(Object.hasOwn(rows, table) || table === "app_schema_versions", "FIXTURE_TABLE_NOT_ALLOWLISTED");
      return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        async maybeSingle() {
          return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.app_schema_versions' in the schema cache" } };
        },
        async range() { return { data: rows[table], error: null }; },
      };
    },
    storage: {
      async listBuckets() {
        return { error: null, data: ["bookstore-news-originals", "bookstore-news-previews"].map((name) => ({
          name, id: name, public: name.endsWith("previews"), updated_at: DUMMY_TIME,
        })) };
      },
      from(bucket) {
        assert.ok(["bookstore-news-originals", "bookstore-news-previews"].includes(bucket), "FIXTURE_BUCKET_NOT_ALLOWLISTED");
        return {
          async list(prefix) {
            assert.equal(prefix, "", "FIXTURE_STORAGE_PREFIX");
            return { error: null, data: [{
              name: IMAGE_PATH, id: "synthetic-file", created_at: DUMMY_TIME, updated_at: DUMMY_TIME,
              metadata: { size: PHOTO_BYTES.length, eTag: "synthetic-tag" },
            }] };
          },
          async download(name) {
            assert.equal(name, IMAGE_PATH, "FIXTURE_STORAGE_OBJECT");
            return { data: new Blob([PHOTO_BYTES]), error: null };
          },
        };
      },
    },
  };
}

async function childMain() {
  const state = { protocol: PROTOCOL, sdkCalled: false, dummyCredentials: false, barrierRan: false, fixtureError: false };
  let hooks;
  try {
    const input = JSON.parse(process.argv[3]);
    assert.ok(MODES.has(input.mode), "FIXTURE_MODE_NOT_ALLOWLISTED");
    assert.ok(input.root.startsWith("/scratch/bookstore-writer-owned-"), "FIXTURE_ROOT_NOT_OWNED");
    const writer = pathToFileURL(path.join(input.repository, "apps/web/scripts/supabase-backup.mjs")).href;
    globalThis.__BOOKSTORE_WRITER_FIXTURE_SDK__ = (url, key) => {
      state.dummyCredentials = url === DUMMY_URL && key === DUMMY_KEY;
      assert.ok(state.dummyCredentials, "FIXTURE_DUMMY_CREDENTIALS_REQUIRED");
      return syntheticClient(input, state);
    };
    hooks = registerHooks({
      resolve(specifier, context, next) {
        if (specifier === "@supabase/supabase-js" && context.parentURL === writer) {
          return { url: "bookstore-fixture:sdk", shortCircuit: true };
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url === "bookstore-fixture:sdk") return { format: "module", shortCircuit: true,
          source: "export const createClient = globalThis.__BOOKSTORE_WRITER_FIXTURE_SDK__;" };
        return next(url, context);
      },
    });
    process.argv = [process.execPath, fileURLToPath(writer), input.requested];
    try { await import(writer); }
    catch { process.stderr.write("FIXTURE_WRITER_REJECTED\n"); process.exitCode = 1; }
  } catch { state.fixtureError = true; process.exitCode = 1; }
  finally {
    hooks?.deregister();
    delete globalThis.__BOOKSTORE_WRITER_FIXTURE_SDK__;
    writeFileSync(3, `${JSON.stringify(state)}\n`);
  }
}

if (process.argv[2] === "--fixture-child") await childMain();
