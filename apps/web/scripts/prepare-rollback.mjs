import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  MAX_MANIFEST_BYTES,
  evaluateRollbackReadiness,
  parsePrepareArguments,
  parseRollbackManifest,
} from "./rollback-readiness-policy.mjs";

// Dependency injection keeps filesystem boundary tests entirely in memory.
// CLI callers cannot select these adapters; the entrypoint uses fixed defaults.
export async function readExplicitManifest(file, { lstat: statFile = lstat, open: openFile = open } = {}) {
  const info = await statFile(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) {
    throw new Error("MANIFEST_FILE_INVALID");
  }
  // O_NOFOLLOW protects the final path component; bounded reads also prevent
  // an unexpectedly growing file from consuming unbounded memory.
  const handle = await openFile(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_MANIFEST_BYTES) throw new Error("MANIFEST_FILE_INVALID");
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > MAX_MANIFEST_BYTES) throw new Error("MANIFEST_SIZE_INVALID");
    return parseRollbackManifest(buffer.subarray(0, count).toString("utf8"));
  } finally {
    await handle.close();
  }
}

// Programmatic adapters exist only for in-memory regression tests. The CLI
// entrypoint passes argv alone and exposes no adapter-selection arguments.
export async function main(args, {
  readManifest = readExplicitManifest,
  output = (value) => console.log(value),
  now = () => new Date().toISOString(),
} = {}) {
  try {
    const file = parsePrepareArguments(args);
    const manifest = await readManifest(file);
    const result = evaluateRollbackReadiness(manifest, { asOf: now() });
    // Only fixed policy codes and booleans leave this process. No manifest
    // strings, filesystem paths, JSON excerpts, or exception messages are echoed.
    output(JSON.stringify({ policyVersion: 2, ...result }, null, 2));
    return result.status === "PREPARED_DECLARED_ONLY" ? 0 : 1;
  } catch {
    output(JSON.stringify({
      policyVersion: 2,
      status: "BLOCKED",
      evidenceStatus: "DECLARED_NOT_VERIFIED",
      executionAvailable: false,
      deploymentAuthorized: false,
      violations: ["INPUT_REJECTED"],
      blockers: [],
    }, null, 2));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
