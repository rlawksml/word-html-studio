import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const appRoot = fileURLToPath(new URL("../", import.meta.url));

test("STAGE-UPLOAD-01 dry-run upload entry resolves packaged application and adapters", { timeout: 120_000 }, async () => {
  // Wrangler's upload main module is the entry basename, regardless of its source directory.
  // Inspect the actual upload artifact rather than assuming source imports keep working.
  const directory = await mkdtemp(path.join(tmpdir(), "bookstore-staging-upload-test-"));
  try {
    const config = JSON.parse(await readFile(path.join(appRoot, "wrangler.staging.json"), "utf8"));
    await execFileAsync(process.execPath, [
      path.join(appRoot, "node_modules/wrangler/bin/wrangler.js"),
      "deploy", "--dry-run", "--config", "wrangler.staging.json", "--outdir", directory,
    ], {
      cwd: appRoot,
      timeout: 100_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") },
    });
    const entry = path.join(directory, path.basename(config.main));
    assert.ok((await stat(entry)).isFile(), "upload main basename must exist");
    const source = await readFile(entry, "utf8");
    const imports = [...source.matchAll(/\bimport\s+[^;]*?\sfrom\s*["']([^"']+)["']/g)].map((match) => match[1]);
    const required = ["./dist/server/index.js", "./worker/staging-gate.mjs", "./worker/staging-assets.mjs"];
    const root = await realpath(directory);
    for (const specifier of required) {
      assert.ok(imports.includes(specifier), `upload entry must import ${specifier}`);
      const resolved = await realpath(path.resolve(path.dirname(entry), specifier));
      assert.ok(resolved.startsWith(`${root}${path.sep}`), "entry imports must stay inside its upload directory");
      assert.ok((await stat(resolved)).isFile(), `${specifier} must resolve to a packaged file`);
    }
  } finally {
    // Only delete this test's freshly created temporary artifact, never app build/data.
    await rm(directory, { recursive: true, force: true });
  }
});
