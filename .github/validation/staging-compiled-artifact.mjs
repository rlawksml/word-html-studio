// Inert, bounded transport format: uint32 manifest length, canonical UTF-8
// JSON manifest, then its ordered file bytes. No tar extraction or app import.
import assert from "node:assert/strict";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fixedError, sha256 } from "./offline-host-support.mjs";

export const STAGING_ARTIFACT_FILE = "staging-compiled.bin";
export const ARTIFACT_FAILURES = Object.freeze([
  "ARTIFACT_ROOT_UNSAFE", "ARTIFACT_ENTRY_UNSAFE", "ARTIFACT_DIRECTORY_LAYOUT", "ARTIFACT_PATH_LAYOUT",
  "ARTIFACT_FILE_UNSAFE", "ARTIFACT_INLINE_MAP", "ARTIFACT_BUILD_SECRET", "ARTIFACT_PUBLIC_MISMATCH", "ARTIFACT_ARCHIVE_INVALID",
  "ARTIFACT_REQUIRED_SERVER", "ARTIFACT_REQUIRED_JS", "ARTIFACT_REQUIRED_CSS",
]);
function check(code, operation) {
  try { return operation(); }
  catch (error) {
    // Do not attach the original exception; it can include the source path.
    if (ARTIFACT_FAILURES.includes(error?.safeCode)) throw error;
    throw fixedError(code);
  }
}
const TOTAL_LIMIT = 64 * 1024 * 1024;
const MANIFEST_LIMIT = 1024 * 1024;
const FILE_LIMIT = 16 * 1024 * 1024;
const ENTRY_LIMIT = 2000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA = /^[a-f0-9]{64}$/;
const ROOTS = ["dist/client", "dist/server"];
const LAYOUT_REGIONS = ["client", "server-root", "server-assets", "server-ssr", "server-ssr-assets", "server-static", "server-ssr-static", "server-other"];
const LAYOUT_EXTENSIONS = ["js", "mjs", "css", "map", "json", "txt", "html", "wasm", "bin", "other"];
const LAYOUT_SHAPES = ["hidden", "long", "nonstandard", "opaque"];
const LAYOUT_REFS = ["worker-entry", "server-module", "client-module"];
const PUNCTUATION = Object.freeze([
  ["at", /@/], ["colon", /:/], ["hash", /#/], ["percent", /%/], ["plus", /\+/],
  ["tilde", /~/], ["dollar", /\$/], ["question", /\?/], ["bracket", /[[\]]/],
  ["parenthesis", /[()]/], ["comma", /,/], ["equals", /=/], ["space", / /],
  ["backslash", /\\/], ["control", /[\x00-\x1f\x7f]/], ["non-ascii", /[^\x00-\x7f]/],
  ["other-ascii", /[!"&'*;<>^`{|}]/],
]);
// The Cloudflare build can emit these runtime/local-dev config sidecars.
// They are not Worker modules or browser assets: do not read or transfer them.
const EXCLUDED_CONFIG = new Set([
  "dist/client/wrangler.json", "dist/client/.dev.vars",
  "dist/server/wrangler.json", "dist/server/.dev.vars",
  "dist/server/ssr/wrangler.json", "dist/server/ssr/.dev.vars",
]);
const PRIVATE_BUILD_MANIFEST = new Set(["dist/server/vinext-server.json", "dist/server/ssr/vinext-server.json"]);
const FORMAT = "bookstore-staging-compiled-v1";
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const GENERATED_SERVER_CHUNK = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,181}-[A-Za-z0-9_-]{8,20}\.m?js$/;
const SERVER_STATIC_TILDE_LEAF = /^[A-Za-z0-9_][A-Za-z0-9._~-]{0,124}\.js(?![\s\S])/;
// Unlike an external map filename, an inline data URL can hide original source
// inside an otherwise allowlisted JS/CSS build output. Fail closed on directives.
const INLINE_SOURCE_MAP = /(?:\/\/|\/\*)\s*[#@]\s*sourceMappingURL\s*=\s*["']?data:/i;
const GENERATED = new Set([
  "dist/client/.assetsignore", "dist/client/.vite/manifest.json", "dist/client/_headers",
  "dist/client/vinext-client-entry-manifest.json",
  "dist/server/.vite/manifest.json", "dist/server/image-config.json", "dist/server/vinext-externals.json",
  "dist/server/BUILD_ID", "dist/server/RSC_BUILD_ID",
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
  return /^(?:dist\/(?:client|server)|dist\/client\/(?:\.vite|guides|assets|_next(?:\/static(?:\/[A-Za-z0-9._-]+)*)?)|dist\/server\/(?:ssr|(?:ssr\/)?(?:\.vite|assets|_next(?:\/static(?:\/[A-Za-z0-9._-]+)*)?)))$/.test(path);
}

// A bounded set of sanitized compiled paths can be reported from the fixed CI
// build. Do not disclose secret-shaped paths, opaque values or file contents.
export function stagingArtifactPathHint(path) {
  if (typeof path !== "string" || path.length > 220 || !/^dist\/(?:server|client)\/(?:[A-Za-z0-9_@.+\[\]()-]{1,100}\/){0,6}[A-Za-z0-9_@.+\[\]()-]{1,100}$/.test(path)) return null;
  if (path.split("/").some((part) => [".", ".."].includes(part) || /[a-f0-9]{40,}|[a-z0-9_-]{48,}/i.test(part) || /(?:^|[._-])(?:secret|credential|dotenv|env|vars|token|key|data-export)(?:[._-]|$)/i.test(part))) return null;
  return path;
}
function pathFailure(path) {
  let hint = stagingArtifactPathHint(path);
  if (!hint && typeof path === "string") {
    const root = /^dist\/(?:client|server)(?=\/)/.exec(path)?.[0];
    const leaf = path.split("/").at(-1);
    const kind = leaf.startsWith(".") ? "hidden" : leaf.length > 128 ? "long" : /[^A-Za-z0-9_.-]/.test(leaf) ? "shape" : "opaque";
    const suffix = /\.(?:json|m?js|css|map|txt|html|wasm|bin)$/.exec(leaf)?.[0] ?? "";
    if (root) hint = `${root}/[masked-${kind}]${suffix}`;
  }
  return Object.assign(fixedError("ARTIFACT_PATH_LAYOUT"), { pathHints: [hint].filter(Boolean) });
}
function validatePath(path) {
  try { validateAllowedPath(path); }
  catch { throw pathFailure(path); }
}

function isServerStaticTildeModule(path, leaf = path.split("/").at(-1)) {
  // Vinext references these names literally. Only the leaf is exceptional;
  // every parent segment and the file contents still pass the original gates.
  return path.startsWith("dist/server/_next/static/") && leaf.includes("~") && SERVER_STATIC_TILDE_LEAF.test(leaf);
}

function validateAllowedPath(path) {
  assert.equal(typeof path, "string");
  assert.ok(path.length <= 400);
  const parts = path.split("/");
  const assetName = parts.at(-1);
  const generatedModule = path.startsWith("dist/server/") && GENERATED_SERVER_CHUNK.test(assetName);
  const tildeModule = isServerStaticTildeModule(path, assetName);
  assert.ok(parts.length <= 9 && parts.every((part, index) => [".vite", ".assetsignore"].includes(part) || NAME.test(part)
    || (index === parts.length - 1 && (generatedModule || tildeModule))));
  const parent = path.slice(0, path.lastIndexOf("/"));
  assert.ok(allowedDirectory(parent));
  if (GENERATED.has(path) || PUBLIC.has(path)) return;
  assert.ok(generatedModule || !/(?:^|[._~-])(?:secret|credential|dotenv|env|backup|upload|data-export)(?:[._~-]|$)/i.test(assetName));
  if (path.startsWith("dist/client/")) {
    assert.match(path, /^dist\/client\/(?:assets\/|_next\/static\/)(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|css|woff2?|svg|png|webp|jpg|jpeg|gif|ico)$/);
  } else if (!tildeModule) {
    assert.match(path, /^dist\/server\/(?:ssr\/)?(?:assets\/|_next\/static\/(?:[A-Za-z0-9_.-]+\/)*)?[A-Za-z0-9_.-]+\.(?:js|mjs|css|wasm|bin|txt|html)$/);
  }
}

function checkProvenance(value) {
  assert.deepEqual(Object.keys(value).sort(), ["commit", "lockSha256", "packageSha256", "sourceSha256", "tests", "workerTests"]);
  assert.match(value.commit, /^[a-f0-9]{40}$/);
  for (const field of ["sourceSha256", "packageSha256", "lockSha256"]) assert.match(value[field], SHA);
  for (const field of ["tests", "workerTests"]) assert.ok(Number.isSafeInteger(value[field]) && value[field] > 0 && value[field] <= 100000);
}

function rejectInlineSourceMap(path, bytes) {
  if (/\.(?:m?js|css)$/.test(path) && INLINE_SOURCE_MAP.test(bytes.toString("utf8"))) throw fixedError("ARTIFACT_INLINE_MAP");
}

export function readArtifactFile(path, limit) {
  return check("ARTIFACT_FILE_UNSAFE", () => readSingleFile(path, limit));
}
function readSingleFile(path, limit) {
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
  return check("ARTIFACT_ARCHIVE_INVALID", () => collectBuild(appRoot, provenance, publicRoot));
}

// An opt-out transfer run can explain a path rejection without producing even
// an in-memory archive. The same path gate is used; rejected files stay unread.
export function probeCompiledArtifactLayout(appRoot) {
  try { return collectBuild(appRoot, null, null, true); }
  catch { return { status: "unavailable", findings: [] }; }
}

function layoutFinding(path, refs) {
  const leaf = path.split("/").at(-1);
  const parent = dirname(path);
  let region = "server-other";
  if (path.startsWith("dist/client/")) region = "client";
  else if (parent === "dist/server") region = "server-root";
  else if (parent === "dist/server/assets") region = "server-assets";
  else if (parent === "dist/server/ssr") region = "server-ssr";
  else if (parent === "dist/server/ssr/assets") region = "server-ssr-assets";
  else if (/^dist\/server\/ssr\/_next(?:\/|$)/.test(parent)) region = "server-ssr-static";
  else if (/^dist\/server\/_next(?:\/|$)/.test(parent)) region = "server-static";
  const extension = /\.([a-z]+)$/.exec(leaf)?.[1];
  const shape = leaf.startsWith(".") ? "hidden" : leaf.length > 128 ? "long" : /[^A-Za-z0-9_.-]/.test(leaf) ? "nonstandard" : "opaque";
  return { region, extension: LAYOUT_EXTENSIONS.includes(extension) ? extension : "other", shape,
    punctuation: PUNCTUATION.filter(([, pattern]) => pattern.test(leaf)).map(([label]) => label),
    literalRefs: LAYOUT_REFS.filter((label) => refs.has(label)) };
}

function layoutFindings(appRoot, rejected, modules) {
  const byPath = new Map(rejected.map(({ path }) => [path, new Set()]));
  // Evidence only for emitted relative literal imports/re-exports; no JS is
  // parsed/evaluated. No match is not proof an output is unused dynamically.
  let bytesRead = 0;
  for (const path of modules) {
    const bytes = readArtifactFile(join(appRoot, path), Math.min(FILE_LIMIT, TOTAL_LIMIT - bytesRead));
    bytesRead += bytes.length;
    const kind = path === "dist/server/index.js" ? "worker-entry" : path.startsWith("dist/server/") ? "server-module" : "client-module";
    for (const match of bytes.toString("utf8").matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)(["'])(\.\.?\/[^"'\\\r\n]{1,400})\1/g)) {
      let value;
      try { value = decodeURIComponent(match[2].split(/[?#]/, 1)[0]); } catch { continue; }
      byPath.get(posix.normalize(`${posix.dirname(path)}/${value}`))?.add(kind);
    }
  }
  return rejected.map(({ path }) => layoutFinding(path, byPath.get(path)));
}

// Re-validate the untrusted sandbox report on the host, reconstructing only
// fixed enum fields. No path, stack, source text or arbitrary scalar may leave.
export function validateArtifactLayoutProbe(value) {
  assert.deepEqual(Object.keys(value).sort(), ["findings", "status"]);
  assert.ok(["clear", "rejected", "unavailable"].includes(value.status));
  assert.ok(Array.isArray(value.findings) && value.findings.length <= 8);
  assert.equal(value.findings.length > 0, value.status === "rejected");
  function orderedSubset(values, allowed) {
    assert.ok(Array.isArray(values));
    assert.deepEqual(values, allowed.filter((label) => values.includes(label)));
    return [...values];
  }
  return { status: value.status, findings: value.findings.map((entry) => {
    assert.deepEqual(Object.keys(entry).sort(), ["extension", "literalRefs", "punctuation", "region", "shape"]);
    const { region, extension, shape } = entry;
    assert.ok(LAYOUT_REGIONS.includes(region) && LAYOUT_EXTENSIONS.includes(extension) && LAYOUT_SHAPES.includes(shape));
    return { region, extension, shape, punctuation: orderedSubset(entry.punctuation, PUNCTUATION.map(([label]) => label)),
      literalRefs: orderedSubset(entry.literalRefs, LAYOUT_REFS) };
  }) };
}

function collectBuild(appRoot, provenance, publicRoot, layoutProbe = false) {
  if (!layoutProbe) checkProvenance(provenance);
  check("ARTIFACT_ROOT_UNSAFE", () => {
    for (const root of [appRoot, ...ROOTS.map((name) => join(appRoot, name))]) {
      assert.equal(realpathSync(root), root);
      assert.ok(lstatSync(root).isDirectory());
    }
  });
  const selected = [];
  const rejected = [];
  const buildOnlySecrets = new Set();
  let entries = 0, probedNames = 0, total = 0;
  const visit = (path) => {
    if (++entries > ENTRY_LIMIT || path.split("/").length > 9) throw pathFailure(path);
    const absolute = join(appRoot, path);
    const info = check("ARTIFACT_ENTRY_UNSAFE", () => {
      assert.equal(realpathSync(absolute), absolute);
      return lstatSync(absolute);
    });
    if (info.isDirectory()) {
      if (!allowedDirectory(path)) throw Object.assign(fixedError("ARTIFACT_DIRECTORY_LAYOUT"), { pathHints: [stagingArtifactPathHint(path)].filter(Boolean) });
      for (const name of check("ARTIFACT_DIRECTORY_LAYOUT", () => readdirSync(absolute))) {
        if (layoutProbe && ++probedNames > ENTRY_LIMIT) throw fixedError("ARTIFACT_DIRECTORY_LAYOUT");
        const relative = `${path}/${name}`;
        try {
          if (!NAME.test(name) && name !== ".vite" && name !== ".assetsignore" && !EXCLUDED_CONFIG.has(relative)
            && !(relative.startsWith("dist/server/") && GENERATED_SERVER_CHUNK.test(name))
            && !isServerStaticTildeModule(relative, name)) throw pathFailure(relative);
          visit(relative);
        } catch (error) {
          if (error?.safeCode !== "ARTIFACT_PATH_LAYOUT" || entries > ENTRY_LIMIT) throw error;
          // A single build can identify several missing manifest rules. None of
          // these files is read, and any rejected entry still blocks transfer.
          if (layoutProbe) {
            if (rejected.length < 8) rejected.push({ path: relative });
          } else {
            rejected.push(error.pathHints?.[0] ?? null);
            if (rejected.length >= 8) throw Object.assign(fixedError("ARTIFACT_PATH_LAYOUT"), { pathHints: rejected.filter(Boolean) });
          }
        }
      }
      return;
    }
    if (EXCLUDED_CONFIG.has(path)) {
      check("ARTIFACT_FILE_UNSAFE", () => assert.ok(info.isFile() && info.nlink === 1 && info.size <= 65536));
      return;
    }
    if (PRIVATE_BUILD_MANIFEST.has(path)) {
      if (layoutProbe) return; // no build-only secret is needed for a layout probe
      // These Vinext sidecars carry a prerender-only random key. Check it
      // inside the isolated build; never emit the sidecar or value to the host.
      check("ARTIFACT_BUILD_SECRET", () => {
        const metadata = JSON.parse(readSingleFile(absolute, 65536).toString("utf8"));
        assert.match(metadata.prerenderSecret, /^[a-f0-9]{64}$/);
        buildOnlySecrets.add(metadata.prerenderSecret);
      });
      return;
    }
    validatePath(path);
    if (layoutProbe) {
      if (/\.m?js$/.test(path)) selected.push(path);
      return;
    }
    check("ARTIFACT_FILE_UNSAFE", () => assert.ok(info.size <= FILE_LIMIT && total + info.size <= TOTAL_LIMIT));
    const bytes = readArtifactFile(absolute, FILE_LIMIT);
    rejectInlineSourceMap(path, bytes);
    if (PUBLIC.has(path)) check("ARTIFACT_PUBLIC_MISMATCH", () => {
      assert.ok(bytes.equals(readSingleFile(join(publicRoot, path.slice("dist/client/".length)), FILE_LIMIT)));
    });
    total += bytes.length;
    selected.push({ record: { path, bytes: bytes.length, sha256: sha256(bytes) }, bytes });
  };
  for (const root of ROOTS) visit(root);
  if (layoutProbe) return rejected.length ? { status: "rejected", findings: layoutFindings(appRoot, rejected, selected) } : { status: "clear", findings: [] };
  if (rejected.length) throw Object.assign(fixedError("ARTIFACT_PATH_LAYOUT"), { pathHints: rejected.filter(Boolean) });
  for (const secret of buildOnlySecrets) {
    if (selected.some(({ bytes }) => bytes.includes(secret))) throw fixedError("ARTIFACT_BUILD_SECRET");
  }
  selected.sort((a, b) => Buffer.compare(Buffer.from(a.record.path), Buffer.from(b.record.path)));
  const files = selected.map(({ record }) => record);
  const manifest = Buffer.from(JSON.stringify({ format: FORMAT, provenance, total, files }));
  assert.ok(manifest.length <= MANIFEST_LIMIT);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(manifest.length);
  return Buffer.concat([prefix, manifest, ...selected.map(({ bytes }) => bytes)]);
}

export function verifyCompiledArtifact(archive, expected) {
  return check("ARTIFACT_ARCHIVE_INVALID", () => verifyArchive(archive, expected));
}
function verifyArchive(archive, expected) {
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
  if (!files.some(({ path, bytes }) => path === "dist/server/index.js" && bytes.length > 0)) throw fixedError("ARTIFACT_REQUIRED_SERVER");
  for (const [extension, code] of [[".js", "ARTIFACT_REQUIRED_JS"], [".css", "ARTIFACT_REQUIRED_CSS"]]) {
    if (!files.some(({ path, bytes }) => path.startsWith("dist/client/_next/static/") && path.endsWith(extension) && bytes.length > 0)) throw fixedError(code);
  }
  return { files, sha256: sha256(archive), bytes: archive.length };
}
