// Assemble FROM scratch from canonical runner toolchain; no remote image/RUN.
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { bounded, readRegular, requireSuccess } from "./offline-host-support.mjs";

const HOST_PREFIX = /^(?:\/usr\/|\/opt\/)/;
const LIB_PREFIX = /^\/(?:lib\/|lib64\/|usr\/lib\/)/;
function copyBytes(source, target, limit, mode = 0o444) {
  const bytes = readRegular(source, limit);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  writeFileSync(target, bytes, { flag: "wx", mode });
  chmodSync(target, mode);
  return bytes.length;
}
export async function copyRuntime(rootfs, node, npmCli, trusted, role, step) {
  assert.ok(["prep", "app"].includes(role));
  assert.equal(typeof step, "function");
  let totalBytes = 0;
  const copy = (source, target, limit, mode) => {
    const count = copyBytes(source, target, limit, mode);
    totalBytes += count;
    assert.ok(totalBytes <= 440 * 1024 * 1024); // source adds at most 64MiB
    return count;
  };
  step("PATHS");
  assert.ok(HOST_PREFIX.test(node) && HOST_PREFIX.test(npmCli));
  assert.equal(realpathSync(node), node);
  assert.equal(realpathSync(npmCli), npmCli);
  assert.ok(npmCli.endsWith("/npm/bin/npm-cli.js"));
  const npmRoot = dirname(dirname(npmCli));
  step("NPM_METADATA");
  assert.equal(JSON.parse(readRegular(join(npmRoot, "package.json"), 65536)).name, "npm");
  step("NODE_VERSION");
  const version = requireSuccess(await bounded(node, ["--version"], { env: { PATH: "/usr/bin:/bin" }, ms: 5000 }), "TRUSTED_NODE_VERSION_UNCONFIRMED").trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match && (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 18)));
  step("NODE_COPY");
  copy(node, join(rootfs, "usr/bin/node"), 256 * 1024 * 1024, 0o555);
  step("ENV_COPY");
  const env = realpathSync("/usr/bin/env");
  const envInfo = lstatSync(env);
  assert.ok(Number.isSafeInteger(envInfo.size) && envInfo.size >= 0);
  // Runner-owned /usr/bin/env metadata only, not an application file/path.
  const prefix = env.startsWith("/usr/") ? "USR" : "OTHER";
  console.log(`OFFLINE_TRUSTED_ENV bytes=${envInfo.size} prefix=${prefix} regular=${envInfo.isFile() ? 1 : 0}`);
  assert.ok(env.startsWith("/usr/"));
  // The observed runner-owned env is 11,807,104 bytes, exceeding the old cap.
  // Bound this trusted tool at 16MiB; the aggregate 440MiB runtime budget and
  // all container memory/disk/process/network limits remain unchanged.
  copy(env, join(rootfs, "usr/bin/env"), 16 * 1024 * 1024, 0o555);
  let runtimeBytes = 0, runtimeFiles = 0;
  const copyNpm = (source, destination, ancestors = new Set()) => {
    const canonical = realpathSync(source);
    assert.ok(canonical === npmRoot || canonical.startsWith(`${npmRoot}/`));
    const info = lstatSync(canonical);
    assert.ok(!ancestors.has(canonical));
    if (info.isDirectory()) {
      mkdirSync(destination, { recursive: true, mode: 0o755 });
      for (const entry of readdirSync(canonical)) {
        if (/^(?:\.?npmrc)$/i.test(entry)) continue; // omit builtin npm config, too
        assert.ok(entry !== "." && entry !== ".." && !/[\x00-\x1f\\]/.test(entry));
        copyNpm(join(canonical, entry), join(destination, entry), new Set([...ancestors, canonical]));
      }
    } else {
      assert.ok(info.isFile() && info.size <= 16 * 1024 * 1024);
      runtimeFiles++;
      assert.ok(runtimeFiles <= 20000);
      runtimeBytes += copy(canonical, destination, 16 * 1024 * 1024);
      assert.ok(runtimeBytes <= 128 * 1024 * 1024);
    }
  };
  // The offline image deliberately has NO npm CLI, so a missing native output
  // cannot trigger a package-manager fallback there. Only prep has this tool.
  step("NPM_COPY");
  if (role === "prep") copyNpm(npmRoot, join(rootfs, "usr/lib/npm"));
  step("LDD");
  // Observed loader failure needs this one existing runner OS compatibility
  // library. No host install, search, checkout or downloaded binary is used.
  step("OS_COMPAT_LIBRARY");
  assert.equal(process.arch, "x64");
  const compatibilityTarget = "/usr/lib/x86_64-linux-gnu/librt.so.1";
  const compatibilitySource = realpathSync(compatibilityTarget);
  assert.ok(compatibilitySource.startsWith("/usr/lib/x86_64-linux-gnu/"));
  const compatibilityInfo = lstatSync(compatibilitySource);
  assert.ok(compatibilityInfo.isFile() && compatibilityInfo.uid === 0 && (compatibilityInfo.mode & 0o022) === 0);
  assert.ok(readRegular(compatibilitySource, 16 * 1024 * 1024).subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])));
  const copiedLibraries = new Map();
  const compatibilityBytes = copy(compatibilitySource, join(rootfs, compatibilityTarget.slice(1)), 16 * 1024 * 1024, 0o444);
  copiedLibraries.set(compatibilityTarget, { canonical: compatibilitySource, mode: 0o444 });
  console.log(`OFFLINE_TRUSTED_COMPAT librt=1 bytes=${compatibilityBytes}`);
  // ldd is applied ONLY to canonical runner Node/env and this exact trusted OS
  // library, NEVER to a checkout or downloaded package binary.
  for (const [binary, executable] of [[node, true], [env, true], [compatibilitySource, false]]) {
    const text = requireSuccess(await bounded("/usr/bin/ldd", [binary], { env: { PATH: "/usr/bin:/bin" }, ms: 5000 }), "TRUSTED_RUNTIME_LDD_FAILED");
    let libraries = 0, interpreters = 0;
    for (const line of text.trim().split("\n")) {
      if (/^\s*linux-vdso\.so\.\d+\s+\(0x[a-f0-9]+\)$/.test(line)) continue;
      const dependency = /^\s*\S+ => (\/\S+) \(0x[a-f0-9]+\)$/.exec(line)?.[1];
      const interpreter = /^\s*(\/\S+) \(0x[a-f0-9]+\)$/.exec(line)?.[1];
      const library = dependency ?? interpreter;
      assert.ok(library && LIB_PREFIX.test(library));
      const canonical = realpathSync(library);
      assert.ok(LIB_PREFIX.test(canonical));
      libraries++;
      if (interpreter) interpreters++;
      // Only the canonicalized direct PT_INTERP loader needs execute access.
      // Ordinary mapped .so files remain 0444; duplicates can only upgrade.
      const mode = interpreter ? 0o555 : 0o444;
      const destination = join(rootfs, library.slice(1));
      const previous = copiedLibraries.get(library);
      if (previous) {
        assert.equal(previous.canonical, canonical);
        assert.ok(readRegular(canonical, 64 * 1024 * 1024).equals(readRegular(destination, 64 * 1024 * 1024)));
        if (mode > previous.mode) {
          chmodSync(destination, mode);
          previous.mode = mode;
        }
        continue;
      }
      copy(canonical, destination, 64 * 1024 * 1024, mode);
      copiedLibraries.set(library, { canonical, mode });
    }
    assert.ok(libraries > 0 && (!executable || interpreters === 1));
  }
  step("CA");
  const ca = realpathSync("/etc/ssl/certs/ca-certificates.crt");
  assert.ok(ca.startsWith("/etc/ssl/certs/") || ca.startsWith("/usr/share/ca-certificates/"));
  copy(ca, join(rootfs, "etc/ssl/certs/ca-certificates.crt"), 2 * 1024 * 1024);
  step("HELPERS");
  for (const name of ["offline-baseline.mjs", "offline-host-support.mjs", "offline-sandbox-common.mjs", role === "prep" ? "offline-prep-launcher.mjs" : "offline-app-launcher.mjs"]) {
    assert.equal(relative(trusted, resolve(trusted, name)), name);
    copy(join(trusted, name), join(rootfs, "trusted", name), 32768);
  }
  if (role === "prep") {
    // Two distinct empty, readonly configs: npm rejects loading one pathname
    // for both user and global scopes. Never copy real host configuration.
    for (const name of ["npm-user.conf", "npm-global.conf"]) {
      const target = join(rootfs, "trusted", name);
      writeFileSync(target, "", { flag: "wx", mode: 0o444 });
      chmodSync(target, 0o444);
    }
  }
  for (const name of ["scratch", "toolchain", "input", "source", "tmp"]) mkdirSync(join(rootfs, name), { mode: 0o755 });
  chmodSync(join(rootfs, "scratch"), 0o1777);
  return { nodeVersion: version, npmFiles: runtimeFiles, npmBytes: runtimeBytes, totalBytes };
}
