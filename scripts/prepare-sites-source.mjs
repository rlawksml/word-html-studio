import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STAGING_PROJECT = "appgprj_6a9e5e7aea3c8191a70eae751c212394";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { maxBuffer: 128 * 1024 * 1024 });
}

// Local preparation only: never pushes, deploys, reads .env, or contacts a DB.
export async function prepareSitesSource(repository, revision) {
  const commit = git(repository, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]).toString().trim();
  const tree = git(repository, ["rev-parse", `${commit}:apps/web`]).toString().trim();
  const entries = git(repository, ["ls-tree", "-rz", tree]).toString().split("\0").filter(Boolean).map((line) => {
    const separator = line.indexOf("\t");
    const [mode, type, object] = line.slice(0, separator).split(" ");
    const name = line.slice(separator + 1);
    const parts = name.split("/");
    if (type !== "blob" || !["100644", "100755"].includes(mode)) throw new Error("Symlinks and submodules cannot be exported.");
    if (parts.some((part) => !part || part === ".." || part === "." || part.includes("\\"))) throw new Error("Unsafe source path.");
    if (parts.some((part) => ["node_modules", ".git", "dist", ".next", ".wrangler", "backups", ".npmrc", ".netrc", "credentials"].includes(part)
      || (part.startsWith(".env") && part !== ".env.example") || /\.(pem|key|p12|pfx|jks)$/i.test(part))) {
      throw new Error("Sensitive or generated files are tracked; export refused.");
    }
    return { mode, object, name };
  });
  const manifestEntry = entries.find((entry) => entry.name === ".openai/hosting.json");
  if (!manifestEntry) throw new Error("App hosting manifest is missing.");
  const manifest = JSON.parse(git(repository, ["cat-file", "blob", manifestEntry.object]).toString());
  if (Object.keys(manifest).some((key) => !["project_id", "static", "d1", "r2", "capabilities"].includes(key))) throw new Error("Unexpected hosting manifest key.");
  if (manifest.project_id !== STAGING_PROJECT) throw new Error("Only the existing Staging project may be prepared.");
  if (entries.some((entry) => entry.name === "deployment-provenance.json")) throw new Error("Reserved provenance filename already exists.");

  // Always a new directory: no overwrite/cleanup of any existing user's data.
  const destination = await mkdtemp(path.join(tmpdir(), "bookstore-sites-source-"));
  const files = [];
  for (const entry of entries) {
    const bytes = git(repository, ["cat-file", "blob", entry.object]);
    const target = path.join(destination, entry.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx", mode: entry.mode === "100755" ? 0o755 : 0o644 });
    if (entry.mode === "100755") await chmod(target, 0o755);
    const digest = sha256(bytes);
    if (sha256(await readFile(target)) !== digest) throw new Error("Export byte verification failed.");
    files.push({ path: entry.name, mode: entry.mode, sha256: digest });
  }
  const provenance = { formatVersion: 1, sourceCommit: commit, sourceTree: tree, sourcePath: "apps/web", projectId: manifest.project_id, files };
  await writeFile(path.join(destination, "deployment-provenance.json"), JSON.stringify(provenance, null, 2) + "\n", { flag: "wx" });
  return { destination, sourceCommit: commit, sourceTree: tree, fileCount: files.length, deployed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [repository, revision, ...extra] = process.argv.slice(2);
  if (!repository || !revision || extra.length) throw new Error("Usage: node scripts/prepare-sites-source.mjs <repository> <committed-revision>");
  console.log(JSON.stringify(await prepareSitesSource(path.resolve(repository), revision)));
}
