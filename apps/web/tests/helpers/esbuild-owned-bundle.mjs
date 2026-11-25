// Test-only ownership: stop the service created by THIS bundle and observe its
// real close event before the test worker exits. Never kill by PID or name.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { build, stop } from "esbuild";

const require = createRequire(import.meta.url);
const packagePath = realpathSync(require.resolve("esbuild/package.json"));
const packageVersion = require("esbuild/package.json").version;
const modulesRoot = resolve(dirname(packagePath), "..");
assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
let active = false;

export async function bundleWithOwnedService(options) {
  assert.equal(active, false, "owned bundling must not overlap");
  active = true;
  const originalSpawn = childProcess.spawn;
  let owned = null, bundled;
  function intercept(...args) {
    const [file, argv] = args;
    const service = typeof file === "string" && ["esbuild", "esbuild.exe"].includes(basename(file))
      && Array.isArray(argv) && argv.length === 2 && argv[0] === `--service=${packageVersion}` && argv[1] === "--ping";
    if (!service) return Reflect.apply(originalSpawn, this, args);
    assert.equal(owned, null, "one owned bundler service only");
    assert.ok(isAbsolute(file), "owned service must use an absolute binary");
    const canonical = realpathSync(file);
    assert.ok(canonical.startsWith(`${modulesRoot}${sep}`), "service must stay in installed modules");
    const installed = relative(modulesRoot, canonical).split(sep).join("/");
    assert.match(installed, /^@esbuild\/[a-z0-9-]+\/(?:bin\/)?esbuild(?:\.exe)?$/);
    const child = Reflect.apply(originalSpawn, this, args);
    const record = { child, error: false, closed: false, close: null };
    record.close = new Promise((done) => {
      child.once("error", () => { record.error = true; });
      child.once("close", () => { record.closed = true; done(); });
    });
    owned = record;
    return child;
  }
  try {
    childProcess.spawn = intercept;
    bundled = await build(options);
  } finally {
    childProcess.spawn = originalSpawn;
    try {
      if (owned) {
        // esbuild unrefs its native process; stop() itself does not await close.
        // Keep only this captured handle alive until libuv has reaped it.
        owned.child.ref();
        let timeout;
        try {
          const deadline = new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("owned bundler close timed out")), 5000);
          });
          await Promise.race([Promise.resolve().then(() => stop()).then(() => owned.close), deadline]);
          assert.equal(owned.error, false, "owned bundler must not emit an error");
        } finally {
          clearTimeout(timeout);
          owned.child.unref(); // failure stays failure; outer sandbox cleans it
        }
      }
    } finally { active = false; }
  }
  assert.ok(owned?.closed, "bundle must own and observe a closed service");
  return { result: bundled, lifecycle: { services: Number(owned !== null), closed: Number(owned.closed) } };
}
