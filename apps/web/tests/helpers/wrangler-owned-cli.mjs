// Test-only preload for the published Wrangler CLI's dry-run process. Observe
// its own esbuild child closing before Node exits; never find/kill by PID/name.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute } from "node:path";

const require = createRequire(import.meta.url);
const cli = realpathSync(require.resolve("wrangler"));
assert.equal(realpathSync(process.argv[1]), cli, "preload requires the published CLI entry");
assert.equal(require("wrangler/package.json").version, "4.149.0");
assert.ok(Number(process.versions.node.split(".")[0]) >= 22);
const [command, dryRun, configFlag, config, outFlag, outdir, ...extra] = process.argv.slice(2);
assert.deepEqual([command, dryRun, configFlag, config, outFlag],
  ["deploy", "--dry-run", "--config", "wrangler.staging.json", "--outdir"]);
assert.ok(typeof outdir === "string" && isAbsolute(outdir) && extra.length === 0);

// Resolve from Wrangler, not from the test: stop() must address the exact
// external esbuild module used by this CLI process, including nested installs.
const cliRequire = createRequire(cli);
const esbuildPackage = realpathSync(cliRequire.resolve("esbuild/package.json"));
const esbuildVersion = JSON.parse(readFileSync(esbuildPackage, "utf8")).version;
assert.equal(esbuildVersion, "0.28.2");
const esbuildRequire = createRequire(esbuildPackage);
const nativePackage = `@esbuild/${process.platform}-${process.arch}`;
const nativeVersion = esbuildRequire(`${nativePackage}/package.json`).version;
assert.equal(nativeVersion, esbuildVersion);
const expectedBinary = realpathSync(esbuildRequire.resolve(
  `${nativePackage}/${process.platform === "win32" ? "esbuild.exe" : "bin/esbuild"}`,
));
const esbuild = cliRequire("esbuild");
const originalSpawn = childProcess.spawn;
const originalExit = process.exit.bind(process);
let owned = null, cleanupPromise = null, finishing = false;

function capture(...args) {
  const [file, argv] = args;
  const service = typeof file === "string" && ["esbuild", "esbuild.exe"].includes(basename(file))
    && Array.isArray(argv) && argv.some((value) => typeof value === "string" && value.startsWith("--service="));
  if (!service) return Reflect.apply(originalSpawn, this, args);
  assert.equal(owned, null, "dry-run must own one esbuild service only");
  assert.ok(isAbsolute(file));
  assert.equal(realpathSync(file), expectedBinary, "service must use Wrangler's installed native binary");
  assert.deepEqual(argv, [`--service=${esbuildVersion}`, "--ping"]);
  const child = Reflect.apply(originalSpawn, this, args);
  const record = { child, error: false, closed: false, close: null };
  record.close = new Promise((done) => {
    child.once("error", () => { record.error = true; });
    child.once("close", () => { record.closed = true; done(); });
  });
  owned = record;
  return child;
}
childProcess.spawn = capture;

function cleanup() {
  cleanupPromise ??= (async () => {
    // A startup error may exit before starting esbuild. Preserve that exit
    // code without claiming a service lifecycle; the caller requires a marker.
    if (!owned) return;
    owned.child.ref();
    let timer, expired = false;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("owned CLI service close timed out"));
        }, 5000);
      });
      await Promise.race([
        Promise.resolve().then(() => esbuild.stop()).then(() => owned.close).then(async () => {
          assert.equal(expired, false);
          assert.equal(owned.error, false, "owned CLI service must not emit an error");
          assert.equal(owned.closed, true);
          // Flush a constant marker only, never the CLI's captured output.
          await new Promise((resolve, reject) => process.stdout.write(
            "WRANGLER_OWNED_CLI_LIFECYCLE services=1 closed=1\n",
            (error) => error ? reject(error) : resolve(),
          ));
        }),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
      owned.child.unref();
      childProcess.spawn = originalSpawn;
    }
  })();
  return cleanupPromise;
}

function finish(code) {
  if (finishing) return;
  finishing = true;
  const exitCode = code ?? process.exitCode ?? 0;
  // Wrangler can call process.exit() explicitly on failure, bypassing
  // beforeExit. Keep only this owned handle alive until close in both paths.
  void cleanup().then(() => originalExit(exitCode), () => originalExit(1));
}
process.exit = finish;
process.once("beforeExit", (code) => finish(process.exitCode ?? code));
