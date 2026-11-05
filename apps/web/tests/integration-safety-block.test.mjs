import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertLegacyIntegrationBlocked } from "./helpers/owned-cleanup-plan.mjs";

const entry = new URL("./supabase-integration.test.mjs", import.meta.url);
const blockedMessage = "SUPABASE_INTEGRATION_BLOCKED_UNSAFE_LEGACY_CLEANUP";
const safeEnv = Object.freeze({
  HOME: "/scratch", TMPDIR: "/scratch", XDG_CACHE_HOME: "/scratch",
  PATH: "/usr/bin:/bin", TZ: "UTC", UV_THREADPOOL_SIZE: "2",
});

// Synthetic, public project identifiers from the source allowlist; no real keys.
const syntheticEnv = {
  APP_ENV: "staging",
  SUPABASE_URL: "https://kriyjyyudngtibrtkylf.supabase.co",
  EXPECTED_SUPABASE_PROJECT_REF: "kriyjyyudngtibrtkylf",
  BLOCKED_SUPABASE_PROJECT_REFS: "kdigttaghqubfjsmbngl",
  SUPABASE_SECRET_KEY: "synthetic-not-a-real-key",
  INPUT_ACCESS_CODES: "synthetic-input-code",
  HTML_ACCESS_CODES: "synthetic-html-code",
};

// A loader tripwire refuses SDK/Worker resolution before those modules can load.
const loader = `export async function resolve(specifier, context, next) {
  if (specifier.includes("@supabase/") || /dist\\/server\\//.test(specifier)) {
    process.stderr.write("FORBIDDEN_DEPENDENCY_RESOLUTION");
    throw new Error("FORBIDDEN_DEPENDENCY_RESOLUTION");
  }
  return next(specifier, context);
}`;

// Register the tripwire without --experimental-loader's source-echo warning.
// The same forbidden dependency resolution hook remains active.
const loaderImport = "data:text/javascript," + encodeURIComponent(
  'import { register } from "node:module"; register(' +
  JSON.stringify("data:text/javascript," + encodeURIComponent(loader)) + ', import.meta.url);',
);

function attempt(env) {
  const program = `let fetchCalls = 0;
    globalThis.fetch = () => { fetchCalls++; throw new Error("FORBIDDEN_HTTP"); };
    let message = null;
    try { await import(${JSON.stringify(entry.href)}); } catch (error) { message = error.message; }
    process.stdout.write("\\nSAFETY_RESULT=" + JSON.stringify({message, fetchCalls}) + "\\n");`;
  const result = spawnSync(process.execPath, [
    "--import", loaderImport,
    "--input-type=module", "--eval", program,
  ], { env: { ...env, ...safeEnv }, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /FORBIDDEN_DEPENDENCY_RESOLUTION/);
  const line = result.stdout.split("\n").find((value) => value.startsWith("SAFETY_RESULT="));
  assert.ok(line, "child must report its guard outcome");
  return { outcome: JSON.parse(line.slice("SAFETY_RESULT=".length)), stdout: result.stdout };
}

test("enabled legacy entry hard-blocks even a target-valid synthetic environment before SDK/Worker/HTTP", () => {
  const { outcome } = attempt({ ...syntheticEnv, RUN_SUPABASE_INTEGRATION: "1" });
  assert.deepEqual(outcome, { message: blockedMessage, fetchCalls: 0 });
});

test("hard block precedes target validation and has no environment override", () => {
  const { outcome } = attempt({ RUN_SUPABASE_INTEGRATION: "1", APP_ENV: "production",
    ALLOW_UNSAFE_CLEANUP: "1", SKIP_CLEANUP_GUARD: "1" });
  assert.deepEqual(outcome, { message: blockedMessage, fetchCalls: 0 });
});

test("disabled integration stays skipped without loading SDK/Worker or making HTTP requests", () => {
  const { outcome, stdout } = attempt({ RUN_SUPABASE_INTEGRATION: "0" });
  assert.deepEqual(outcome, { message: null, fetchCalls: 0 });
  assert.match(stdout, /# SKIP/);
});

test("source contract keeps the unconditional enabled block ahead of target checks and dynamic SDK import", async () => {
  const source = await readFile(entry, "utf8");
  const block = source.indexOf("if (enabled) assertLegacyIntegrationBlocked()");
  assert.ok(block > 0);
  assert.ok(block < source.indexOf("if (enabled) assertIntegrationTarget(process.env)"));
  assert.ok(block < source.indexOf('await import("@supabase/supabase-js")'));
  assert.doesNotMatch(source, /import\s+[^;]*\sfrom\s+["']@supabase\//);
});

test("shared legacy blocker ignores arguments, including purported overrides", () => {
  for (const override of [undefined, true, { allow: true }, { RUN_SUPABASE_INTEGRATION: "0" }]) {
    assert.throws(() => assertLegacyIntegrationBlocked(override), new RegExp(blockedMessage));
  }
});

test("local npm entry blocks before any env-file, SDK, Worker or HTTP load", async () => {
  const runner = new URL("./run-integration-local.mjs", import.meta.url);
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["test:integration:local"], "node tests/run-integration-local.mjs");
  const source = await readFile(runner, "utf8");
  assert.match(source, /assertLegacyIntegrationBlocked\(\)/);
  assert.doesNotMatch(source, /(?:readFile|dotenv|--env-file|supabase-js|dist\/server)/);
  const tripwire = `globalThis.fetch = () => { process.stderr.write("FORBIDDEN_HTTP"); throw new Error("FORBIDDEN_HTTP"); };`;
  const result = spawnSync(process.execPath, [
    "--import", loaderImport,
    "--import", `data:text/javascript,${encodeURIComponent(tripwire)}`,
    runner.pathname,
  ], { env: safeEnv, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(blockedMessage));
  assert.doesNotMatch(result.stderr, /FORBIDDEN_DEPENDENCY_RESOLUTION|FORBIDDEN_HTTP/);
});
