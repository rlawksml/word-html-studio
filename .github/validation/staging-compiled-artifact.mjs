// Inert, bounded transport format: uint32 manifest length, canonical UTF-8
// JSON manifest, then its ordered file bytes. No tar extraction or app import.
import assert from "node:assert/strict";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./offline-host-support.mjs";

export const STAGING_ARTIFACT_FILE = "staging-compiled.bin";
const TOTAL_LIMIT = 64 * 1024 * 1024;
const MANIFEST_LIMIT = 1024 * 1024;
const FILE_LIMIT = 16 * 1024 * 1024;
const ENTRY_LIMIT = 2000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA = /^[a-f0-9]{64}$/;
const ROOTS = ["dist/client", "dist/server"];
const FORMAT = "bookstore-staging-compiled-v1";
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
// Unlike an external map filename, an inline data URL can hide original source
// inside an otherwise allowlisted JS/CSS build output. Fail closed on directives.
const INLINE_SOURCE_MAP = /(?:\/\/|\/\*)\s*[#@]\s*sourceMappingURL\s*=\s*["']?data:/i;
const GENERATED = new Set([
  "dist/client/.assetsignore", "dist/client/.vite/manifest.json", "dist/client/_headers",
  "dist/server/.vite/manifest.json", "dist/server/image-config.json", "dist/server/vinext-externals.json",
  "dist/server/vinext-server.json", "dist/server/ssr/vinext-server.json",
]);
const PUBLIC = new Set([
  "dist/client/favicon.svg", "dist/client/file.svg", "dist/client/globe.svg", "dist/client/window.svg",
  "dist/client/og-bookstore-news.png", "dist/client/guides/bookstore-news-input-guide.pdf",
]);

export function validateStagingTransfer(approved, storageCheckedAt, now = Date.now()) {
  if (approved === "false" && storageCheckedAt === "") return false;
  assert.equal(approved, "true");
  assert.match(storageCheckedAt, TIMESTAMP);
  const checked = Date.parse(storageCheckedAt);
  assert.equal(new Date(checked).toISOString(), storageCheckedAt);
  assert.ok(Number.isSafeInteger(now) && checked <= now && now - checked <= 3600_000);
  return true;
}

function allowedDirectory(path) {
  return /^(?:dist\/(?:client|server)|dist\/client\/(?:\.vite|guides|assets|_next(?:\/static)?(?:\/[A-Za-z0-9._-]+)*)|dist\/server\/(?:\.vite|assets|ssr(?:\/assets)?))$/.test(path);
}

function validatePath(path) {
  assert.equal(typeof path, "string");
  assert.ok(path.length <= 400);
  assert.ok(path.split("/").length <= 9 && path.split("/").every((part) => [".vite", ".assetsignore"].includes(part) || NAME.test(part)));
  const parent = path.slice(0, path.lastIndexOf("/"));
  assert.ok(allowedDirectory(parent));
  if (GENERATED.has(path) || PUBLIC.has(path)) return;
  const assetName = path.slice(path.lastIndexOf("/") + 1);
  assert.ok(!/(?:^|[._-])(?:secret|credential|dotenv|env|backup|upload|data-export)(?:[._-]|$)/i.test(assetName));
  if (path.startsWith("dist/client/")) {
    assert.match(path, /^dist\/client\/(?:assets\/|_next\/static\/)(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|css|woff2?|svg|png|webp|jpg|jpeg|gif|ico)$/);
  } else {
    assert.match(path, /^dist\/server\/(?:ssr\/)?(?:assets\/)?[A-Za-z0-9_.-]+\.(?:js|mjs|css|wasm|bin|txt|html)$/);
  }
}

function checkProvenance(value) {
  assert.deepEqual(Object.keys(value).sort(), ["commit", "lockSha256", "packageSha256", "sourceSha256", "tests", "workerTests"]);
  assert.match(value.commit, /^[a-f0-9]{40}$/);
  for (const field of ["sourceSha256", "packageSha256", "lockSha256"]) assert.match(value[field], SHA);
  for (const field of ["tests", "workerTests"]) assert.ok(Number.isSafeInteger(value[field]) && value[field] > 0 && value[field] <= 100000);
}

function rejectInlineSourceMap(path, bytes) {
  if (/\.(?:m?js|css)$/.test(path)) assert.ok(!INLINE_SOURCE_MAP.test(bytes.toString("utf8")));
}

export function readArtifactFile(path, limit) {
  assert.equal(realpathSync(path), path);
  const entry = lstatSync(path);
  assert.ok(entry.isFile() && entry.nlink === 1 && entry.size <= limit);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    assert.ok(opened.isFile() && opened.nlink === 1 && opened.dev === entry.dev && opened.ino === entry.ino && opened.size === entry.size);
    const bytes = Buffer.alloc(entry.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0);
      offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, offset), 0);
    const after = fstatSync(fd);
    assert.ok(after.nlink === 1 && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs);
    return bytes;
  } finally { closeSync(fd); }
}

export function collectCompiledArtifact(appRoot, provenance, publicRoot) {
  checkProvenance(provenance);
  assert.equal(realpathSync(appRoot), appRoot);
  const selected = [];
  let entries = 0, total = 0;
  const visit = (path) => {
    assert.ok(++entries <= ENTRY_LIMIT && path.split("/").length <= 9);
    const absolute = join(appRoot, path);
    const info = lstatSync(absolute);
    assert.equal(realpathSync(absolute), absolute);
    if (info.isDirectory()) {
      assert.ok(allowedDirectory(path));
      for (const name of readdirSync(absolute)) {
        assert.ok(NAME.test(name) || name === ".vite" || name === ".assetsignore");
        visit(`${path}/${name}`);
      }
      return;
    }
    // Generated build config is never transported or used as a deploy target.
    if (path === "dist/server/wrangler.json") {
      assert.ok(info.isFile() && info.nlink === 1 && info.size <= 65536);
      return;
    }
    validatePath(path);
    assert.ok(info.size <= FILE_LIMIT && total + info.size <= TOTAL_LIMIT);
    const bytes = readArtifactFile(absolute, FILE_LIMIT);
    rejectInlineSourceMap(path, bytes);
    if (PUBLIC.has(path)) assert.ok(bytes.equals(readArtifactFile(join(publicRoot, path.slice("dist/client/".length)), FILE_LIMIT)));
    total += bytes.length;
    selected.push({ record: { path, bytes: bytes.length, sha256: sha256(bytes) }, bytes });
  };
  for (const root of ROOTS) visit(root);
  selected.sort((a, b) => Buffer.compare(Buffer.from(a.record.path), Buffer.from(b.record.path)));
  const files = selected.map(({ record }) => record);
  const manifest = Buffer.from(JSON.stringify({ format: FORMAT, provenance, total, files }));
  assert.ok(manifest.length <= MANIFEST_LIMIT);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(manifest.length);
  return Buffer.concat([prefix, manifest, ...selected.map(({ bytes }) => bytes)]);
}

export function verifyCompiledArtifact(archive, expected) {
  checkProvenance(expected);
  assert.ok(Buffer.isBuffer(archive) && archive.length >= 5 && archive.length <= 4 + MANIFEST_LIMIT + TOTAL_LIMIT);
  const size = archive.readUInt32BE(0);
  assert.ok(size > 0 && size <= MANIFEST_LIMIT && 4 + size <= archive.length);
  const raw = archive.subarray(4, 4 + size);
  const manifest = JSON.parse(raw.toString("utf8"));
  assert.ok(Buffer.from(JSON.stringify(manifest)).equals(raw)); // no duplicate keys or alternate framing
  assert.deepEqual(Object.keys(manifest).sort(), ["files", "format", "provenance", "total"]);
  assert.equal(manifest.format, FORMAT);
  assert.deepEqual(manifest.provenance, expected);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= ENTRY_LIMIT);
  assert.ok(Number.isSafeInteger(manifest.total) && manifest.total >= 0 && manifest.total <= TOTAL_LIMIT);
  assert.equal(archive.length, 4 + size + manifest.total);
  let offset = 4 + size, previous = "";
  const paths = new Map();
  const files = manifest.files.map((record) => {
    assert.deepEqual(Object.keys(record).sort(), ["bytes", "path", "sha256"]);
    validatePath(record.path);
    assert.ok(Buffer.compare(Buffer.from(previous), Buffer.from(record.path)) < 0);
    previous = record.path;
    const parts = record.path.split("/");
    for (let depth = 1; depth <= parts.length; depth++) {
      const exact = parts.slice(0, depth).join("/"), folded = exact.toLowerCase();
      const isFile = depth === parts.length;
      if (paths.has(folded)) assert.deepEqual(paths.get(folded), { exact, isFile: false });
      assert.ok(!isFile || !paths.has(folded));
      paths.set(folded, { exact, isFile });
    }
    assert.match(record.sha256, SHA);
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.bytes <= FILE_LIMIT && offset + record.bytes <= archive.length);
    const bytes = archive.subarray(offset, offset + record.bytes);
    offset += record.bytes;
    assert.equal(sha256(bytes), record.sha256);
    rejectInlineSourceMap(record.path, bytes);
    return { path: record.path, bytes };
  });
  // Refuse an empty/test-only set. These are the real worker entry and browser assets.
  assert.equal(offset, archive.length);
  assert.ok(files.some(({ path, bytes }) => path === "dist/server/index.js" && bytes.length > 0));
  for (const extension of [".js", ".css"]) {
    assert.ok(files.some(({ path, bytes }) => path.startsWith("dist/client/_next/static/") && path.endsWith(extension) && bytes.length > 0));
  }
  return { files, sha256: sha256(archive), bytes: archive.length };
}
