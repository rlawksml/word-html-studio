import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectSitesSource } from "./prepare-sites-source.mjs";

// Read-only, strict clean-source verification. Build artifacts are not ignored.
export async function verifySitesSource(repository, revision, destination) {
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { maxBuffer: 128 * 1024 * 1024 });
  const { commit, tree, entries, manifest } = inspectSitesSource(repository, revision);
  if (!(await lstat(destination)).isDirectory() || (await lstat(destination)).isSymbolicLink()) throw new Error("Unsafe export root.");
  const actual = new Map();
  async function walk(directory, prefix = "") {
    for (const name of await readdir(directory)) {
      const relative = prefix + name;
      const target = path.join(directory, name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error("Symlink in export.");
      if (stat.isDirectory()) await walk(target, relative + "/");
      else if (stat.isFile()) actual.set(relative, { target, mode: stat.mode & 0o111 ? "100755" : "100644" });
      else throw new Error("Unsupported export entry.");
    }
  }
  await walk(destination);
  const records = [];
  for (const { name, mode, object } of entries) {
    const file = actual.get(name);
    if (!file || file.mode !== mode) throw new Error("Missing file or executable mode mismatch.");
    const bytes = git("cat-file", "blob", object);
    if (!bytes.equals(await readFile(file.target))) throw new Error("Source bytes mismatch.");
    records.push({ path: name, mode, sha256: createHash("sha256").update(bytes).digest("hex") });
    actual.delete(name);
  }
  if (actual.size !== 1 || !actual.has("deployment-provenance.json")) throw new Error("Unexpected export files.");
  const expected = { formatVersion: 1, sourceCommit: commit, sourceTree: tree, sourcePath: "apps/web", projectId: manifest.project_id, files: records };
  const provenance = JSON.parse(await readFile(actual.get("deployment-provenance.json").target));
  if (JSON.stringify(provenance) !== JSON.stringify(expected)) throw new Error("Provenance mismatch.");
  return { verified: true, sourceCommit: commit, sourceTree: tree, fileCount: records.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [repository, revision, destination, ...extra] = process.argv.slice(2);
  if (!repository || !revision || !destination || extra.length) throw new Error("Usage: node scripts/verify-sites-source.mjs <repository> <revision> <clean-export>");
  console.log(JSON.stringify(await verifySitesSource(repository, revision, destination)));
}
