// A single owned Python child is a filesystem capability, not a cloud client.
// No credentials, ambient environment, shell, detached group or user code goes in.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_FILES = 10000;
const MAX_HEADER_BYTES = 8192;
const MAX_ACK_BYTES = 2048;
const WALL_MS = 15 * 60_000;
const ACK_MS = 30_000;
const PREFIX = "backup-writer-ledger-v1\n";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const failure = (code) => Object.assign(new Error(code), { code });
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sameKeys = (value, expected) => JSON.stringify(Object.keys(value)) === JSON.stringify(expected);

export async function createBackupWriter({ repositoryRoot, destination }) {
  const helper = fileURLToPath(new URL("./backup-dirfd-writer.py", import.meta.url));
  const child = spawn("/usr/bin/python3", ["-I", "-S", "-B", helper], {
    cwd: "/", env: {}, shell: false, detached: false, stdio: ["pipe", "pipe", "pipe"],
  });
  let state = "INITIALIZING", terminal = null, pending = null, input = Buffer.alloc(0);
  let nextId = 0, files = 0, total = 0, queuedBytes = 0, queuedFiles = 0;
  let exitSeen = false, closeSeen = false, finishAck = false, queue = Promise.resolve();
  const ledger = createHash("sha256").update(PREFIX);
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });

  function stop(code) {
    terminal ??= failure(code);
    if (state !== "DONE") state = "FAILED";
    if (pending) {
      clearTimeout(pending.timer);
      const reject = pending.reject;
      pending = null;
      reject(terminal);
    }
    // This child starts no descendants and remains in the caller's owned group.
    // Never signal a PID/group supplied by a message or negative process ID.
    if (!exitSeen && !closeSeen) { try { child.kill("SIGKILL"); } catch { /* close decides */ } }
    return terminal;
  }

  const wall = setTimeout(() => stop("BACKUP_WRITER_DEADLINE"), WALL_MS);
  child.on("error", () => stop("BACKUP_WRITER_RUNTIME_UNAVAILABLE"));
  child.stdin.on("error", () => stop("BACKUP_WRITER_PIPE_FAILED"));
  child.stderr.on("data", () => stop("BACKUP_WRITER_STDERR_PRESENT"));
  child.on("exit", () => { exitSeen = true; });
  child.on("close", (code, signal) => {
    closeSeen = true;
    clearTimeout(wall);
    if (state !== "CLOSING" && state !== "FAILED"
      && !(state === "FINISHING" && finishAck && code === 0 && signal === null && input.length === 0 && pending === null)) {
      stop("BACKUP_WRITER_EXIT_UNCONFIRMED");
    }
    if (pending) stop("BACKUP_WRITER_RESPONSE_MISSING");
    resolveClosed({ code, signal });
  });

  child.stdout.on("data", (part) => {
    if (state === "CLOSING" || state === "FAILED") return;
    if (input.length + part.length > MAX_ACK_BYTES) { stop("BACKUP_WRITER_ACK_LIMIT"); return; }
    input = Buffer.concat([input, part]);
    const newline = input.indexOf(10);
    if (newline === -1) return;
    const line = input.subarray(0, newline + 1);
    input = input.subarray(newline + 1);
    if (!pending || input.length) { stop("BACKUP_WRITER_ACK_INVALID"); return; }
    let response;
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(line);
      response = JSON.parse(text);
      if (!record(response) || `${JSON.stringify(response)}\n` !== text
        || response.v !== 1 || response.id !== pending.id || typeof response.ok !== "boolean") throw new Error();
      if (response.ok === false) {
        if (!sameKeys(response, ["v", "id", "ok", "code"]) || typeof response.code !== "string"
          || !/^BACKUP_WRITER_[A-Z_]{1,48}$/.test(response.code)) throw new Error();
        stop(response.code);
        return;
      }
      const keys = pending.operation === "init" ? ["v", "id", "ok", "op"]
        : ["v", "id", "ok", "op", "files", "bytes", "ledger"];
      if (!sameKeys(response, keys) || response.op !== pending.operation) throw new Error();
      if (pending.expected && (response.files !== pending.expected.files || response.bytes !== pending.expected.bytes
        || response.ledger !== pending.expected.ledger)) throw new Error();
    } catch { stop("BACKUP_WRITER_ACK_INVALID"); return; }
    clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = null;
    if (response.op === "finish") finishAck = true;
    resolve(response);
  });

  function request(operation, fields, payload, expected) {
    if (terminal || pending || closeSeen || ["CLOSING", "DONE"].includes(state)) {
      return Promise.reject(terminal ?? stop("BACKUP_WRITER_STATE_INVALID"));
    }
    const id = ++nextId;
    const header = Buffer.from(`${JSON.stringify({ v: 1, id, op: operation, ...fields })}\n`);
    if (header.length > MAX_HEADER_BYTES) return Promise.reject(stop("BACKUP_WRITER_HEADER_LIMIT"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop("BACKUP_WRITER_RESPONSE_TIMEOUT"), ACK_MS);
      pending = { id, operation, expected, resolve, reject, timer };
      try {
        if (operation === "finish") child.stdin.end(header); // EOF before awaiting ACK.
        else {
          child.stdin.write(header);
          if (payload !== undefined) child.stdin.write(payload);
        }
      } catch { stop("BACKUP_WRITER_PIPE_FAILED"); }
    });
  }

  function serialize(run) {
    const result = queue.then(run);
    // Observe internal rejection immediately; returned promises still reject
    // for callers, without leaving a rejected queue/close promise unhandled.
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function waitClosed(ms) {
    if (closeSeen) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      closed.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  async function close() {
    if (closeSeen) return;
    if (state !== "DONE" && state !== "FAILED") {
      state = "CLOSING";
      if (pending) stop("BACKUP_WRITER_CANCELLED");
      try { child.stdin.end(); } catch { /* exact child close is checked below */ }
    }
    if (!(await waitClosed(2000))) {
      stop("BACKUP_WRITER_CLOSE_TIMEOUT");
      if (!(await waitClosed(2000))) throw failure("BACKUP_WRITER_CLOSE_UNCONFIRMED");
    }
  }

  function put(relative, payload) {
    if (state !== "ACTIVE") return Promise.reject(failure("BACKUP_WRITER_STATE_INVALID"));
    let snapshot;
    try {
      if (typeof relative !== "string" || !(typeof payload === "string" || payload instanceof Uint8Array)) throw new Error();
      const length = typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength;
      if (length > MAX_FILE_BYTES || queuedBytes + length > MAX_FILE_BYTES
        || files + queuedFiles >= MAX_FILES || total + queuedBytes + length > MAX_TOTAL_BYTES) throw new Error();
      snapshot = Buffer.from(payload);
    } catch { return Promise.reject(stop("BACKUP_WRITER_PAYLOAD_LIMIT")); }
    queuedBytes += snapshot.length;
    queuedFiles++;
    return serialize(async () => {
      try {
        if (terminal) throw terminal;
        const fields = { path: relative, bytes: snapshot.length, sha256: sha256(snapshot) };
        const header = Buffer.from(`${JSON.stringify({ v: 1, id: nextId + 1, op: "put", ...fields })}\n`);
        const expected = { files: files + 1, bytes: total + snapshot.length,
          ledger: ledger.copy().update(header).digest("hex") };
        await request("put", fields, snapshot, expected);
        ledger.update(header);
        files = expected.files;
        total = expected.bytes;
      } finally {
        queuedBytes -= snapshot.length;
        queuedFiles--;
      }
    });
  }

  function finish(requiredPaths) {
    if (state !== "ACTIVE") return Promise.reject(failure("BACKUP_WRITER_STATE_INVALID"));
    if (!Array.isArray(requiredPaths) || requiredPaths.length > 9 || requiredPaths.some((item) => typeof item !== "string")) {
      return Promise.reject(stop("BACKUP_WRITER_REQUIRED_FILES"));
    }
    const required = [...requiredPaths];
    state = "FINISHING"; // Synchronous gate: no new PUT can jump behind FINISH.
    return serialize(async () => {
      if (terminal) throw terminal;
      const expected = { files, bytes: total, ledger: ledger.copy().digest("hex") };
      await request("finish", { files, bytes: total, ledger: expected.ledger, required }, undefined, expected);
      if (!(await waitClosed(2000))) throw stop("BACKUP_WRITER_CLOSE_TIMEOUT");
      const result = await closed;
      if (terminal || result.code !== 0 || result.signal !== null || !finishAck || input.length) {
        throw terminal ?? stop("BACKUP_WRITER_COMMIT_UNCONFIRMED");
      }
      state = "DONE";
    });
  }

  try {
    await request("init", { repository: repositoryRoot, destination });
    if (terminal || closeSeen) throw terminal ?? failure("BACKUP_WRITER_INIT_FAILED");
    state = "ACTIVE";
  } catch (error) {
    await close();
    throw error;
  }
  return Object.freeze({ put, finish, close });
}
