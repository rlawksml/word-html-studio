// Trusted parent-only assembler for the dedicated backup writer fixture suite.
// Hash-review this native-only file before execution. No pip, package source,
// host config, download, shell, or fixture code runs on the host.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [rootfs, ...extra] = process.argv.slice(2);
const LIMIT = 128 * 1024 * 1024;
const SKIP = new Set(["site-packages", "dist-packages", "__pycache__", "test", "tests", "idlelib", "tkinter", "ensurepip", "venv"]);
let bytes = 0, files = 0;
function trusted(path) {
  assert.ok(/^\/(?:usr\/|lib\/|lib64\/)/.test(path));
  const canonical = realpathSync(path), info = lstatSync(canonical);
  assert.ok(/^\/(?:usr\/|lib\/|lib64\/)/.test(canonical));
  assert.ok(info.uid === 0 && (info.mode & 0o022) === 0 && !info.isSymbolicLink());
  for (let parent = dirname(canonical); ; parent = dirname(parent)) {
    const directory = lstatSync(parent);
    assert.ok(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === 0 && (directory.mode & 0o022) === 0);
    if (parent === "/") break;
  }
  return { canonical, info };
}
function elf(path) {
  const { canonical, info } = trusted(path);
  assert.ok(info.isFile() && info.size >= 4 && info.size <= 32 * 1024 * 1024);
  const fd = openSync(canonical, "r"), header = Buffer.alloc(4);
  try { assert.equal(readSync(fd, header, 0, 4, 0), 4); }
  finally { closeSync(fd); }
  assert.ok(header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])));
}
function command(file, args) {
  const result = spawnSync(file, args, { env: {}, cwd: "/", shell: false, encoding: "utf8",
    timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(!result.error && !result.signal && result.status === 0 && !result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) <= 65536);
  return result.stdout;
}
function copy(source, relative, mode = 0o444) {
  assert.ok(relative && !relative.startsWith("/") && relative.split("/").every((x) => x && x !== "." && x !== ".."));
  const { canonical, info } = trusted(source);
  assert.ok(info.isFile() && info.size > 0 && info.size <= 32 * 1024 * 1024);
  const content = readFileSync(canonical);
  assert.equal(content.length, info.size);
  const destination = join(rootfs, relative);
  if (existsSync(destination)) {
    const previous = lstatSync(destination);
    assert.ok(previous.isFile() && !previous.isSymbolicLink() && content.equals(readFileSync(destination)));
    if ((previous.mode & 0o777) < mode) chmodSync(destination, mode);
    return;
  }
  bytes += content.length;
  files++;
  assert.ok(bytes <= LIMIT && files <= 10000);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
  writeFileSync(destination, content, { flag: "wx", mode });
  chmodSync(destination, mode);
}
function libraries(binary) {
  elf(binary);
  const output = command("/usr/bin/ldd", [binary]);
  const lines = output.trim().split("\n");
  assert.ok(lines.length > 0 && lines.length <= 128);
  for (const line of lines) {
    if (/^\s*linux-vdso\.so\.\d+\s+\(0x[a-f0-9]+\)$/.test(line)) continue;
    const dependency = /^\s*\S+ => (\/\S+) \(0x[a-f0-9]+\)$/.exec(line)?.[1];
    const loader = /^\s*(\/\S+) \(0x[a-f0-9]+\)$/.exec(line)?.[1];
    const path = dependency ?? loader;
    assert.ok(path && /^\/(?:lib\/|lib64\/|usr\/lib\/)/.test(path));
    const { canonical, info } = trusted(path);
    assert.ok(info.isFile() && /^\/(?:lib\/|lib64\/|usr\/lib\/)/.test(canonical));
    elf(canonical);
    copy(path, path.slice(1), loader ? 0o555 : 0o444);
  }
}
try {
  assert.equal(process.platform, "linux");
  assert.ok(!extra.length && typeof rootfs === "string");
  assert.match(rootfs, /^\/tmp\/bookstore-source-policy-qa\.[A-Za-z0-9]{10}\/context\/rootfs$/);
  assert.equal(realpathSync(rootfs), rootfs);
  assert.deepEqual(Object.keys(process.env).sort(), ["PATH", "TZ"]);
  assert.equal(process.env.PATH, "/usr/bin:/bin");
  assert.equal(process.env.TZ, "UTC");
  const { canonical: python, info } = trusted("/usr/bin/python3");
  assert.match(python, /^\/usr\/bin\/python3\.\d+$/);
  assert.ok(info.isFile() && (info.mode & 0o111) !== 0);
  elf(python);
  // Fixed distro layout only: no Python or stdlib imports execute on the host.
  const minor = Number(/python3\.(\d+)$/.exec(python)[1]);
  assert.ok(Number.isInteger(minor) && minor >= 11 && minor <= 14);
  const expected = `python3.${minor}`;
  const roots = [`/usr/lib/${expected}`];
  const ldd = trusted("/usr/bin/ldd");
  assert.equal(ldd.canonical, "/usr/bin/ldd");
  assert.ok(ldd.info.isFile() && ldd.info.size > 0 && ldd.info.size <= 65536 && (ldd.info.mode & 0o111) !== 0);
  for (const root of roots) {
    assert.ok(root === `/usr/lib/${expected}` || root === `/usr/local/lib/${expected}`);
    const resolved = trusted(root);
    assert.equal(resolved.canonical, root);
    assert.ok(resolved.info.isDirectory());
  }
  const extensions = [];
  const visit = (source, destination, ancestors = new Set()) => {
    const { canonical, info: entry } = trusted(source);
    assert.ok(roots.some((root) => canonical === root || canonical.startsWith(`${root}/`)));
    const components = canonical.split("/");
    assert.ok(!components.some((name) => SKIP.has(name)));
    assert.ok(!ancestors.has(canonical));
    if (entry.isDirectory()) {
      const names = readdirSync(canonical);
      assert.ok(names.length <= 10000);
      for (const name of names) {
        assert.ok(name && name !== "." && name !== ".." && !/[\x00-\x1f\x7f\\]/.test(name));
        if (SKIP.has(name) || name.endsWith(".pyc") || name.startsWith("_test")) continue;
        visit(join(canonical, name), `${destination}/${name}`, new Set([...ancestors, canonical]));
      }
    } else {
      assert.ok(entry.isFile());
      if (entry.size === 0) {
        // A few standard package __init__.py files are intentionally empty.
        assert.ok(source.endsWith(".py"));
        const target = join(rootfs, destination);
        mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
        if (!existsSync(target)) { writeFileSync(target, "", { flag: "wx", mode: 0o444 }); files++; }
        else assert.ok(readFileSync(target).length === 0 && lstatSync(target).isFile() && !lstatSync(target).isSymbolicLink());
        assert.ok(files <= 10000);
        return;
      }
      copy(canonical, destination);
      if (canonical.endsWith(".so")) extensions.push(canonical);
    }
  };
  copy(python, "usr/bin/python3", 0o555);
  libraries(python);
  for (const root of roots) visit(root, root.slice(1));
  assert.ok(extensions.length <= 256);
  for (const extension of [...new Set(extensions)]) libraries(extension);
  console.log(`SOURCE_PYTHON_RUNTIME_COPIED files=${files} bytes=${bytes} major=3 minor=${minor}`);
} catch (error) {
  // Only a line number in this reviewed parent helper, never source paths,
  // Python/ldd output or exception text, is permitted for setup diagnostics.
  const line = /source-python-runtime\.mjs:(\d+):\d+/.exec(error?.stack ?? "")?.[1] ?? "0";
  console.error(`SOURCE_PYTHON_RUNTIME_BLOCKED line=${line}`);
  process.exitCode = 1;
}
