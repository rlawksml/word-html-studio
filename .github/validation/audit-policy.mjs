// Pure, fail-closed npm audit schema/outcome policy. No package import or I/O.
// This checks data shape, not whether npm's registry supplied complete advice.
import assert from "node:assert/strict";

export const CAPTURE_LIMIT = 65536;
export const AUDIT_WALL_MS = 90_000;
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const COUNT_KEYS = [...SEVERITIES, "total"];
const DEPENDENCY_KEYS = ["prod", "dev", "optional", "peer", "peerOptional", "total"];
const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const LOCK_PATH = /^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/;
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const CVE = /^CVE-[0-9]{4}-[0-9]{4,10}$/;
const VERSION = /^(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$/;
const SCHEMA_STEPS = Object.freeze(["ROOT", "METADATA", "RECORD_NAME", "RECORD_KEYS", "RECORD_IDENTITY",
  "RECORD_SEVERITY", "RECORD_VIA_REF", "RECORD_VIA_SEVERITY", "RECORD_AGGREGATE", "RECORD_EFFECTS",
  "ADVISORY", "URL", "NODE", "FIX", "COUNTERS"]);
const REASONS = new Set(["NONE", "HIGH_OR_CRITICAL", "OUTPUT_CAP", "TIMEOUT", "PROCESS", "STDERR", "JSON", "ENDPOINT", "EXIT_MISMATCH",
  ...SCHEMA_STEPS.map((step) => `SCHEMA_${step}`)]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value, max = 4000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const keys = (value, expected) => {
  assert.ok(record(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
};
function text(value, limit) { assert.ok(typeof value === "string" && value.length <= limit); }
function packageName(value) { text(value, 256); assert.ok(NAME.test(value) && !/[\x00-\x20\x7f]/.test(value) && ![".", ".."].includes(value)); }
const advisoryId = (value) => typeof value === "string" && !/\s/.test(value) && (GHSA.test(value) || CVE.test(value));
export function npmVersion(value) { assert.ok(typeof value === "string" && !/\s/.test(value) && VERSION.test(value)); return value; }

export function lockInventory(lock) {
  assert.ok(record(lock) && lock.lockfileVersion === 3 && record(lock.packages));
  const entries = Object.entries(lock.packages);
  assert.ok(entries.length > 0 && entries.length <= 4000 && record(lock.packages[""]));
  const names = new Set(), paths = new Map();
  for (const [path, item] of entries) {
    assert.ok(record(item) && !item.link);
    if (path === "") continue;
    assert.ok(LOCK_PATH.test(path) && path.split("/").every((part) => part !== "." && part !== ".."));
    const installedName = path.slice(path.lastIndexOf("node_modules/") + 13);
    packageName(installedName);
    const aliases = new Set([installedName]);
    if (Object.hasOwn(item, "name")) { packageName(item.name); aliases.add(item.name); }
    for (const name of aliases) names.add(name);
    paths.set(path, aliases);
  }
  assert.ok(names.size > 0 && paths.size > 0);
  return { names, paths };
}
function knownName(value, inventory) { packageName(value); assert.ok(inventory.names.has(value)); }
function distinctStrings(values, limit, check) {
  assert.ok(Array.isArray(values) && values.length <= limit);
  assert.equal(new Set(values).size, values.length);
  values.forEach(check);
}
function advisory(value, inventory, ids, sources, step) {
  step("ADVISORY");
  keys(value, ["source", "name", "dependency", "title", "url", "severity", "cwe", "cvss", "range"]);
  assert.ok(Number.isSafeInteger(value.source) && value.source > 0 && value.source <= 9_999_999_999);
  knownName(value.name, inventory);
  knownName(value.dependency, inventory);
  text(value.title, 4096);
  text(value.range, 4096);
  assert.ok(SEVERITIES.includes(value.severity));
  distinctStrings(value.cwe, 64, (item) => { assert.match(item, /^CWE-[0-9]{1,8}$/); });
  keys(value.cvss, ["score", "vectorString"]);
  assert.ok(value.cvss.score === null || (Number.isFinite(value.cvss.score) && value.cvss.score >= 0 && value.cvss.score <= 10));
  assert.ok(value.cvss.vectorString === null || typeof value.cvss.vectorString === "string");
  if (value.cvss.vectorString !== null) text(value.cvss.vectorString, 512);
  step("URL");
  text(value.url, 512);
  const url = new URL(value.url);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash);
  assert.equal(url.href, value.url);
  let id;
  if (url.hostname === "github.com" && !url.search) id = /^\/advisories\/(GHSA-[a-z0-9-]+)$/.exec(url.pathname)?.[1];
  else if (url.hostname === "nvd.nist.gov" && !url.search) id = /^\/vuln\/detail\/(CVE-[0-9-]+)$/.exec(url.pathname)?.[1];
  else if (url.hostname === "www.cve.org" && url.pathname === "/CVERecord") {
    assert.deepEqual([...url.searchParams.keys()], ["id"]);
    id = url.searchParams.get("id");
  }
  assert.ok(advisoryId(id));
  ids.add(id);
  sources.add(value.source);
  assert.ok(ids.size <= 128 && sources.size <= 128);
  return value.severity;
}
function fix(value, inventory) {
  if (typeof value === "boolean") return;
  keys(value, ["name", "version", "isSemVerMajor"]);
  knownName(value.name, inventory);
  text(value.version, 128);
  assert.match(value.version, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  assert.equal(typeof value.isSemVerMajor, "boolean");
}
function reportSummary(report, inventory, step) {
  step("ROOT");
  keys(report, ["auditReportVersion", "vulnerabilities", "metadata"]);
  assert.equal(report.auditReportVersion, 2);
  assert.ok(record(report.vulnerabilities));
  step("METADATA");
  keys(report.metadata, ["vulnerabilities", "dependencies"]);
  keys(report.metadata.vulnerabilities, COUNT_KEYS);
  keys(report.metadata.dependencies, DEPENDENCY_KEYS);
  for (const item of Object.values(report.metadata.dependencies)) assert.ok(count(item));
  // A pinned nonempty lock cannot be validated by an empty dependency report.
  // Do not equate overlapping prod/dev/optional counters or OS/omit selection.
  assert.ok(report.metadata.dependencies.total > 0);
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
  const ids = new Set(), sources = new Set(), records = Object.entries(report.vulnerabilities);
  step("COUNTERS");
  assert.ok(records.length <= 4000);
  for (const [name, item] of records) {
    step("RECORD_NAME");
    knownName(name, inventory);
    step("RECORD_KEYS");
    keys(item, ["name", "severity", "isDirect", "via", "effects", "range", "nodes", "fixAvailable"]);
    step("RECORD_IDENTITY");
    assert.equal(item.name, name);
    step("RECORD_SEVERITY");
    assert.ok(SEVERITIES.includes(item.severity));
    step("RECORD_IDENTITY");
    assert.equal(typeof item.isDirect, "boolean");
    step("RECORD_SEVERITY");
    text(item.range, 4096);
    assert.ok(Array.isArray(item.via) && item.via.length > 0 && item.via.length <= 4000);
    for (const via of item.via) {
      if (typeof via === "string") {
        step("RECORD_VIA_REF");
        knownName(via, inventory);
        assert.ok(Object.hasOwn(report.vulnerabilities, via) && record(report.vulnerabilities[via]));
        const severity = report.vulnerabilities[via].severity;
        step("RECORD_VIA_SEVERITY");
        assert.ok(SEVERITIES.includes(severity));
        // npm11.19.1 emits range-specific metavulns as dependency names. That
        // linked record's maximum can include unrelated, higher advisories.
        // https://github.com/npm/cli/blob/v11.19.1/workspaces/arborist/lib/vuln.js
      } else {
        const severity = advisory(via, inventory, ids, sources, step);
        // A direct advisory object belongs to this record's own maximum.
        step("RECORD_AGGREGATE");
        assert.ok(SEVERITIES.indexOf(item.severity) >= SEVERITIES.indexOf(severity));
      }
    }
    step("RECORD_EFFECTS");
    distinctStrings(item.effects, 4000, (effect) => knownName(effect, inventory));
    step("NODE");
    distinctStrings(item.nodes, 4000, (path) => {
      assert.ok(typeof path === "string" && inventory.paths.has(path) && inventory.paths.get(path).has(name));
    });
    assert.ok(item.nodes.length > 0);
    step("FIX");
    fix(item.fixAvailable, inventory);
    counts[item.severity]++;
    counts.total++;
  }
  step("COUNTERS");
  assert.ok(records.length === 0 || ids.size > 0);
  for (const key of COUNT_KEYS) {
    assert.ok(count(report.metadata.vulnerabilities[key]));
    assert.equal(report.metadata.vulnerabilities[key], counts[key]);
  }
  return { vulnerabilities: counts, advisoryIds: [...ids].sort(), sourceIds: [...sources].sort((a, b) => a - b) };
}
function blocked(version, reason) {
  assert.ok(REASONS.has(reason));
  return { outcome: "BLOCKED", reason, npmVersion: npmVersion(version), vulnerabilities: null, advisoryIds: [], sourceIds: [] };
}
export function classifyAudit(result, inventory, version) {
  npmVersion(version);
  assert.ok(Buffer.isBuffer(result.stdout) && Buffer.isBuffer(result.stderr));
  if (result.stdout.length + result.stderr.length > CAPTURE_LIMIT || result.reason === "OUTPUT_CAP") return blocked(version, "OUTPUT_CAP");
  if (result.reason === "TIMEOUT") return blocked(version, "TIMEOUT");
  if (result.limited || result.error || result.signal || ![0, 1].includes(result.code)) return blocked(version, "PROCESS");
  if (result.stderr.length) return blocked(version, "STDERR");
  let report;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.stdout);
    report = JSON.parse(raw);
    // Conservative npm JSON formatting contract also rejects duplicate keys,
    // a BOM and trailing payload. Unexpected CLI formatting is BLOCKED.
    assert.equal(raw, `${JSON.stringify(report, null, 2)}\n`);
  } catch { return blocked(version, "JSON"); }
  if (record(report) && Object.hasOwn(report, "error")) return blocked(version, "ENDPOINT");
  let summary, schemaStep = "ROOT";
  // Local fixed labels only. Never inspect/return an assertion message, key,
  // advisory title, URL, package name or raw report in a schema diagnostic.
  const step = (value) => { assert.ok(SCHEMA_STEPS.includes(value)); schemaStep = value; };
  try { summary = reportSummary(report, inventory, step); }
  catch { return blocked(version, `SCHEMA_${schemaStep}`); }
  const findings = summary.vulnerabilities.high + summary.vulnerabilities.critical > 0;
  if (result.code !== (findings ? 1 : 0)) return blocked(version, "EXIT_MISMATCH");
  return { outcome: findings ? "FINDINGS" : "PASS", reason: findings ? "HIGH_OR_CRITICAL" : "NONE", npmVersion: version, ...summary };
}
export function validateSummary(value, version) {
  keys(value, ["outcome", "reason", "npmVersion", "vulnerabilities", "advisoryIds", "sourceIds"]);
  assert.equal(value.npmVersion, npmVersion(version));
  assert.ok(REASONS.has(value.reason));
  if (value.outcome === "BLOCKED") {
    assert.ok(!["NONE", "HIGH_OR_CRITICAL"].includes(value.reason));
    assert.equal(value.vulnerabilities, null);
    assert.deepEqual(value.advisoryIds, []);
    assert.deepEqual(value.sourceIds, []);
    return value;
  }
  assert.ok(["PASS", "FINDINGS"].includes(value.outcome));
  keys(value.vulnerabilities, COUNT_KEYS);
  for (const amount of Object.values(value.vulnerabilities)) assert.ok(count(amount));
  assert.equal(value.vulnerabilities.total, SEVERITIES.reduce((sum, severity) => sum + value.vulnerabilities[severity], 0));
  const findings = value.vulnerabilities.high + value.vulnerabilities.critical > 0;
  assert.equal(value.outcome, findings ? "FINDINGS" : "PASS");
  assert.equal(value.reason, findings ? "HIGH_OR_CRITICAL" : "NONE");
  distinctStrings(value.advisoryIds, 128, (id) => assert.ok(advisoryId(id)));
  assert.ok(Array.isArray(value.sourceIds) && value.sourceIds.length <= 128 && new Set(value.sourceIds).size === value.sourceIds.length);
  for (const id of value.sourceIds) assert.ok(Number.isSafeInteger(id) && id > 0 && id <= 9_999_999_999);
  assert.ok(value.vulnerabilities.total === 0 || (value.advisoryIds.length > 0 && value.sourceIds.length > 0));
  return value;
}
export function confirmCompletion(summary, evidence, expected, version) {
  keys(evidence, ["packageSha256", "lockSha256", "children", "preflight", "networkSealed", "running", "oomKilled", "cleaned"]);
  assert.equal(evidence.packageSha256, expected.packageSha256);
  assert.equal(evidence.lockSha256, expected.lockSha256);
  assert.equal(evidence.children, 0);
  for (const key of ["preflight", "networkSealed", "running", "cleaned"]) assert.equal(evidence[key], true);
  assert.equal(evidence.oomKilled, false);
  return validateSummary(summary, version);
}
