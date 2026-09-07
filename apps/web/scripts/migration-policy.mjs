import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LEGACY_RULE_EXCEPTIONS = new Map([
  ["202607210001_initial_workspace.sql", new Set(["DELETE_FROM"])],
  ["202607220001_secure_media_and_flexible_fields.sql", new Set(["DELETE_FROM"])],
]);

const FORBIDDEN_RULES = [
  ["DROP_TABLE", /\bdrop\s+table\b/giu],
  ["DROP_COLUMN", /\balter\s+table\b[^;]*?\bdrop\s+column\b/giu],
  ["TRUNCATE", /\btruncate(?:\s+table)?\b/giu],
  ["DELETE_FROM", /\bdelete\s+from\b/giu],
  ["RENAME_COLUMN", /\balter\s+table\b[^;]*?\brename\s+column\b/giu],
  ["ALTER_COLUMN_TYPE", /\balter\s+table\b[^;]*?\balter\s+column\b[^;]*?\btype\b/giu],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function findForbiddenMigrationStatements(sql) {
  const findings = [];
  for (const [rule, pattern] of FORBIDDEN_RULES) {
    for (const match of sql.matchAll(pattern)) {
      findings.push({
        rule,
        index: match.index ?? 0,
        excerpt: match[0].replace(/\s+/g, " ").slice(0, 180),
      });
    }
  }
  return findings.sort((left, right) => left.index - right.index);
}

export function validateMigrationChanges(changes) {
  return String(changes || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [status, ...paths] = line.split("\t");
      const sqlPaths = paths.filter((filePath) => filePath.endsWith(".sql"));
      if (sqlPaths.length === 0 || status === "A") return [];
      return [`Applied migration files are immutable: ${status} ${sqlPaths.join(" -> ")}`];
    });
}

export async function validateMigrationDirectory(directory) {
  const directoryPath = directory instanceof URL ? fileURLToPath(directory) : path.resolve(directory);
  const manifestPath = path.join(directoryPath, "manifest.json");
  const failures = [];
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.formatVersion !== 1 || !manifest.migrations || typeof manifest.migrations !== "object") {
    failures.push("Migration manifest format is invalid");
  }

  const migrationNames = (await readdir(directoryPath)).filter((name) => name.endsWith(".sql")).sort();
  const manifestNames = Object.keys(manifest.migrations || {}).sort();
  if (JSON.stringify(migrationNames) !== JSON.stringify(manifestNames)) {
    failures.push("Migration manifest file list does not match the SQL directory");
  }

  for (const name of migrationNames) {
    const payload = await readFile(path.join(directoryPath, name));
    if (sha256(payload) !== manifest.migrations?.[name]) {
      failures.push(`${name}: sha256 does not match migration manifest`);
    }
    const exceptions = LEGACY_RULE_EXCEPTIONS.get(name) || new Set();
    for (const finding of findForbiddenMigrationStatements(payload.toString("utf8"))) {
      if (!exceptions.has(finding.rule)) failures.push(`${name}: ${finding.rule} (${finding.excerpt})`);
    }
  }

  return { status: failures.length === 0 ? "PASS" : "FAIL", failures, migrations: migrationNames };
}

function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function readMigrationChanges(baseRef, root = repositoryRoot()) {
  if (!baseRef) return "";
  return execFileSync(
    "git",
    ["diff", "--name-status", `${baseRef}...HEAD`, "--", "apps/web/supabase/migrations"],
    { cwd: root, encoding: "utf8" },
  );
}

async function main() {
  const root = repositoryRoot();
  const directory = path.join(root, "apps/web/supabase/migrations");
  const result = await validateMigrationDirectory(directory);
  const gitFailures = validateMigrationChanges(readMigrationChanges(process.env.MIGRATION_BASE_REF, root));
  result.failures.push(...gitFailures);
  result.status = result.failures.length === 0 ? "PASS" : "FAIL";
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
