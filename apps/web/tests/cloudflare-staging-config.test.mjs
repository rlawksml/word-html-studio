import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { assertSupabaseRuntimeTarget } from "../lib/supabase-environment.mjs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("wrangler.staging.json", root), "utf8"));

test("CF-STAGE-05 entry imports resolve from Wrangler's uploaded basename", async () => {
  // The upload API names the main module by basename, unlike filesystem-based tests.
  assert.equal(config.main, path.posix.basename(config.main));
  const entry = await readFile(new URL(config.main, root), "utf8");
  const imports = [...entry.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./dist/server/index.js", "./worker/staging-gate.mjs", "./worker/staging-assets.mjs"]);
  for (const specifier of imports) {
    const uploadedName = path.posix.normalize(path.posix.join(path.posix.dirname(path.posix.basename(config.main)), specifier));
    assert.ok(!uploadedName.startsWith("../"));
    await access(new URL(uploadedName, root));
  }
});

test("CF-STAGE-01 isolates identity and disables all public entry points", () => {
  assert.equal(config.account_id, "cbedea3823b7b51a1b7df6d8a2ceed39");
  assert.equal(config.name, "bookstore-news-studio-staging");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  // Exact allowlist also rejects future accidental schedules, bindings or secrets.
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "account_id", "name", "main", "base_dir", "compatibility_date", "compatibility_flags", "no_bundle", "rules", "assets", "ratelimits", "workers_dev", "preview_urls", "routes", "vars"].sort());
  assert.deepEqual(config.ratelimits, [{ name: "STAGING_LOGIN_LIMITER", namespace_id: "20260929", simple: { limit: 5, period: 60 } }]);
});

test("CF-STAGE-02 uses only staging DB and rejects production", () => {
  assert.deepEqual(config.vars, {
    APP_ENV: "staging",
    SUPABASE_URL: "https://kriyjyyudngtibrtkylf.supabase.co",
    EXPECTED_SUPABASE_PROJECT_REF: "kriyjyyudngtibrtkylf",
    BLOCKED_SUPABASE_PROJECT_REFS: "kdigttaghqubfjsmbngl",
  });
  const args = { appEnv: config.vars.APP_ENV, supabaseUrl: config.vars.SUPABASE_URL, expectedProjectRef: config.vars.EXPECTED_SUPABASE_PROJECT_REF, blockedProjectRefs: config.vars.BLOCKED_SUPABASE_PROJECT_REFS };
  assert.equal(assertSupabaseRuntimeTarget(args), config.vars.EXPECTED_SUPABASE_PROJECT_REF);
  assert.throws(() => assertSupabaseRuntimeTarget({ ...args, supabaseUrl: "https://kdigttaghqubfjsmbngl.supabase.co" }));
  assert.throws(() => assertSupabaseRuntimeTarget({ ...args, supabaseUrl: "https://kdigttaghqubfjsmbngl.supabase.co", expectedProjectRef: "kdigttaghqubfjsmbngl" }));
});

test("CF-STAGE-03 matches freshly built runtime without additional services", async () => {
  const built = JSON.parse(await readFile(new URL("dist/server/wrangler.json", root), "utf8"));
  // Unknown generated settings must be reviewed instead of silently discarded.
  const metadata = new Set(["topLevelName", "dev", "name", "compatibility_date", "compatibility_flags", "main", "jsx_factory", "jsx_fragment", "rules", "build", "no_bundle", "assets", "observability", "python_modules"]);
  function isEmpty(value) {
    if (Array.isArray(value)) return value.length === 0;
    return value !== null && typeof value === "object" && Object.values(value).every(isEmpty);
  }
  for (const [key, value] of Object.entries(built)) {
    if (!metadata.has(key)) assert.ok(isEmpty(value), `Review unexpected generated binding/config: ${key}`);
  }
  assert.equal(config.main, "staging-entry.mjs");
  assert.equal(config.base_dir, ".");
  assert.equal(built.main, "index.js");
  assert.deepEqual(config.assets, { directory: "dist/client", binding: "ASSETS", run_worker_first: true });
  assert.equal(built.assets.directory, "../client");
  for (const key of ["compatibility_date", "compatibility_flags", "no_bundle"]) assert.deepEqual(config[key], built[key]);
  assert.deepEqual(config.rules, [
    { type: "ESModule", globs: ["worker/staging-*.mjs", "dist/server/**/*.js", "dist/server/**/*.mjs"] },
    { type: "Text", globs: ["dist/server/**/*.txt", "dist/server/**/*.html"], fallthrough: false },
    { type: "Data", globs: ["dist/server/**/*.bin"], fallthrough: false },
    { type: "CompiledWasm", globs: ["dist/server/**/*.wasm"], fallthrough: false },
  ]);
  await access(new URL(config.main, root));
  await access(new URL(config.assets.directory, root));
});

test("CF-STAGE-04 CI executes the staging gate after build tests", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /- run: npm test\s+- name: Verify independent Cloudflare staging config\s+run: node --test tests\/cloudflare-staging-config.test.mjs/);
  assert.match(workflow, /run: npm run test:staging-worker/);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(pkg.scripts["check:cloudflare-staging"], /npm run test:staging-worker/);
  for (const file of ["staging-gate.test.mjs", "staging-assets.test.mjs", "staging-worker-runtime.test.mjs", "staging-upload-layout.test.mjs"]) {
    assert.ok(pkg.scripts["test:staging-worker"].includes(`tests/${file}`));
  }
});
