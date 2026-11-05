// Reviewed host utility closure: native builtins only, no checkout imports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function requireRegular(path, limit) {
  assert.equal(realpathSync(path), path);
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= limit);
  return info;
}
export function readRegular(path, limit) {
  requireRegular(path, limit);
  const bytes = readFileSync(path);
  assert.ok(bytes.length <= limit);
  return bytes;
}
export function fixedError(code) {
  assert.match(code, /^[A-Z0-9_]{1,96}$/);
  const error = new Error(code);
  error.safeCode = code;
  return error;
}
export function requireSuccess(result, code) {
  if (result.code !== 0 || result.signal || result.limited || result.error) throw fixedError(code);
  return result.stdout.toString("utf8");
}
// Never publishes target bytes. stdout + stderr SHARE the 64KiB bound; hitting
// a cap/timeout is failure. No shell, no inherited stdin/environment/config.
export async function bounded(file, args, { cwd, env = {}, ms = 10_000, signal: abortSignal } = {}) {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve({ code: null, signal: null, limited: true, reason: "ABORTED", error: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
      return;
    }
    let child, timer, limited = false, reason = null, error = false, bytes = 0;
    const stdout = [], stderr = [];
    const stop = (why) => {
      limited = true;
      reason ??= why;
      if (child?.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* close/error still decides */ }
      }
    };
    try {
      child = spawn(file, args, { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ code: null, signal: null, limited: false, error: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
      return;
    }
    timer = setTimeout(() => stop("TIMEOUT"), ms);
    const abort = () => stop("ABORTED");
    abortSignal?.addEventListener("abort", abort, { once: true });
    const collect = (target) => (part) => {
      bytes += part.length;
      if (bytes > 65536) { stop("OUTPUT_CAP"); return; }
      target.push(part);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", () => { error = true; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", abort);
      resolve({ code, signal, limited, reason, error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
