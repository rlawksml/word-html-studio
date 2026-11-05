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
export async function copyRuntime(rootfs, node, npmCli, trusted, role) {
  assert.ok(["prep", "app"].includes(role));
  let totalBytes = 0;
  const copy = (source, target, limit, mode) => {
    const count = copyBytes(source, target, limit, mode);
    totalBytes += count;
    assert.ok(totalBytes <= 440 * 1024 * 1024); // source adds at most 64MiB
    return count;
  };
  assert.ok(HOST_PREFIX.test(node) && HOST_PREFIX.test(npmCli));
  assert.equal(realpathSync(node), node);
  assert.equal(realpathSync(npmCli), npmCli);
  assert.ok(npmCli.endsWith("/npm/bin/npm-cli.js"));
  const npmRoot = dirname(dirname(npmCli));
  assert.equal(JSON.parse(readRegular(join(npmRoot, "package.json"), 65536)).name, "npm");
  const version = requireSuccess(await bounded(node, ["--version"], { env: { PATH: "/usr/bin:/bin" }, ms: 5000 }), "TRUSTED_NODE_VERSION_UNCONFIRMED").trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match && (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 18)));
  copy(node, join(rootfs, "usr/bin/node"), 256 * 1024 * 1024, 0o555);
  const env = realpathSync("/usr/bin/env");
  assert.ok(env.startsWith("/usr/"));
  copy(env, join(rootfs, "usr/bin/env"), 1024 * 1024, 0o555);
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
  if (role === "prep") copyNpm(npmRoot, join(rootfs, "usr/lib/npm"));
  // ldd is NEVER applied to a checkout or downloaded package binary.
  const copiedLibraries = new Map();
  for (const binary of [node, env]) {
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
        if (mode > previous.mode) {
          chmodSync(destination, mode);
          previous.mode = mode;
        }
        continue;
      }
      copy(canonical, destination, 64 * 1024 * 1024, mode);
      copiedLibraries.set(library, { canonical, mode });
    }
    assert.ok(libraries > 0 && interpreters === 1);
  }
  const ca = realpathSync("/etc/ssl/certs/ca-certificates.crt");
  assert.ok(ca.startsWith("/etc/ssl/certs/") || ca.startsWith("/usr/share/ca-certificates/"));
  copy(ca, join(rootfs, "etc/ssl/certs/ca-certificates.crt"), 2 * 1024 * 1024);
  for (const name of ["offline-baseline.mjs", "offline-host-support.mjs", "offline-sandbox-common.mjs", role === "prep" ? "offline-prep-launcher.mjs" : "offline-app-launcher.mjs"]) {
    assert.equal(relative(trusted, resolve(trusted, name)), name);
    copy(join(trusted, name), join(rootfs, "trusted", name), 32768);
  }
  for (const name of ["scratch", "toolchain", "input", "source", "tmp"]) mkdirSync(join(rootfs, name), { mode: 0o755 });
  chmodSync(join(rootfs, "scratch"), 0o1777);
  return { nodeVersion: version, npmFiles: runtimeFiles, npmBytes: runtimeBytes, totalBytes };
}
