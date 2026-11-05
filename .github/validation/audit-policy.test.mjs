// Synthetic native-only tests. These do not contact npm, run an app or prove
// registry advice / Docker isolation. Fixture advisory IDs are not real advice.
import test from "node:test";
import assert from "node:assert/strict";
import { CAPTURE_LIMIT, classifyAudit, confirmCompletion, lockInventory, npmVersion, validateSummary } from "./audit-policy.mjs";

const VERSION = "11.6.2"; // synthetic trusted-runtime version shape only
const lock = { lockfileVersion: 3, packages: { "": {}, "node_modules/alpha": { version: "1.0.0" }, "node_modules/beta": { version: "1.0.0" } } };
const inventory = lockInventory(lock);
function advisory(name, severity) {
  return { source: 1234567, name, dependency: name, title: "never publish this fixture title",
    url: "https://github.com/advisories/GHSA-2345-6789-cfgh", severity, cwe: ["CWE-79"],
    cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N" }, range: "<2.0.0" };
}
function report(severities = {}) {
  const vulnerabilities = {}, counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const [name, severity] of Object.entries(severities)) {
    vulnerabilities[name] = { name, severity, isDirect: true, via: [advisory(name, severity)], effects: [],
      range: "<2.0.0", nodes: [`node_modules/${name}`], fixAvailable: { name, version: "2.0.0", isSemVerMajor: true } };
    counts[severity]++;
    counts.total++;
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts,
    dependencies: { prod: 2, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 2 } } };
}
function result(value, code = 0, extra = {}) {
  return { code, signal: null, error: false, limited: false, reason: null,
    stdout: Buffer.from(`${JSON.stringify(value, null, 2)}\n`), stderr: Buffer.alloc(0), ...extra };
}
const classify = (value, code = 0, extra = {}) => classifyAudit(result(value, code, extra), inventory, VERSION);
function blocked(summary, reason) {
  assert.deepEqual(summary, { outcome: "BLOCKED", reason, npmVersion: VERSION, vulnerabilities: null, advisoryIds: [], sourceIds: [] });
}
const expected = { packageSha256: "a".repeat(64), lockSha256: "b".repeat(64) };
const evidence = () => ({ ...expected, children: 0, preflight: true, networkSealed: true, running: true, oomKilled: false, cleaned: true });

test("AUDIT-01 inventory accepts exact lock names, nested paths and declared aliases", () => {
  const fixture = structuredClone(lock);
  fixture.packages["node_modules/alias"] = { name: "@scope/actual", version: "1.0.0" };
  fixture.packages["node_modules/alpha/node_modules/@scope/nested"] = { version: "1.0.0" };
  const value = lockInventory(fixture);
  assert.ok(value.names.has("alias") && value.names.has("@scope/actual") && value.names.has("@scope/nested"));
  assert.deepEqual([...value.paths.get("node_modules/alias")], ["alias", "@scope/actual"]);
});
test("AUDIT-02 inventory rejects links, traversal and malformed locked names", () => {
  for (const [path, item] of [["node_modules/alpha", { link: true }], ["node_modules/../escape", {}], ["node_modules/alpha", { name: "../../bad" }]]) {
    const fixture = structuredClone(lock);
    fixture.packages[path] = item;
    assert.throws(() => lockInventory(fixture));
  }
  assert.throws(() => lockInventory({ ...lock, lockfileVersion: 2 }));
  assert.throws(() => lockInventory({ lockfileVersion: 3, packages: { "": {} } }));
});
test("AUDIT-03 exit zero with an empty valid report is PASS, not a raw report", () => {
  const value = classify(report());
  assert.equal(value.outcome, "PASS");
  assert.equal(value.vulnerabilities.total, 0);
  assert.deepEqual(value.advisoryIds, []);
  assert.equal(validateSummary(value, VERSION), value);
  assert.ok(!JSON.stringify(value).includes("dependencies"));
});
test("AUDIT-04 exit zero may contain low and moderate findings", () => {
  const value = classify(report({ alpha: "low", beta: "moderate" }));
  assert.equal(value.outcome, "PASS");
  assert.equal(value.vulnerabilities.total, 2);
  assert.equal(value.vulnerabilities.low, 1);
  assert.equal(value.vulnerabilities.moderate, 1);
  assert.ok(!JSON.stringify(value).includes("alpha") && !JSON.stringify(value).includes("fixture title"));
});
test("AUDIT-05 exit one plus high or critical is FINDINGS, not a transport failure", () => {
  const value = classify(report({ alpha: "high", beta: "critical" }), 1);
  assert.equal(value.outcome, "FINDINGS");
  assert.equal(value.reason, "HIGH_OR_CRITICAL");
  assert.deepEqual(value.advisoryIds, ["GHSA-2345-6789-cfgh"]);
  assert.deepEqual(value.sourceIds, [1234567]);
});
test("AUDIT-06 mismatched audit-level exit status is BLOCKED", () => {
  blocked(classify(report({ alpha: "high" }), 0), "EXIT_MISMATCH");
  blocked(classify(report({ alpha: "low" }), 1), "EXIT_MISMATCH");
  blocked(classify(report(), 1), "EXIT_MISMATCH");
});
test("AUDIT-07 process errors, abnormal exit and signal cannot pass", () => {
  for (const extra of [{ error: true }, { signal: "SIGKILL" }, { limited: true }]) blocked(classify(report(), 0, extra), "PROCESS");
  blocked(classify(report(), 2), "PROCESS");
  blocked(classify(report(), null), "PROCESS");
});
test("AUDIT-08 wall timeout and shared stdout-stderr capture cap stay distinct", () => {
  blocked(classify(report(), 0, { limited: true, reason: "TIMEOUT" }), "TIMEOUT");
  blocked(classify(report(), 0, { limited: true, reason: "OUTPUT_CAP" }), "OUTPUT_CAP");
  blocked(classify(report(), 0, { stdout: Buffer.alloc(CAPTURE_LIMIT), stderr: Buffer.from("x") }), "OUTPUT_CAP");
});
test("AUDIT-09 even stderr accompanying valid JSON is conservatively blocked", () => {
  blocked(classify(report(), 0, { stderr: Buffer.from("untrusted endpoint text") }), "STDERR");
});
test("AUDIT-10 malformed, duplicate, BOM, invalid UTF8 and trailing JSON are blocked", () => {
  const good = result(report()).stdout;
  const samples = [Buffer.from("{"), Buffer.from('{"auditReportVersion":2,"auditReportVersion":2}\n'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), good]), Buffer.from([0xff]), Buffer.concat([good, Buffer.from("{}")]), Buffer.from("{}")];
  for (const stdout of samples) blocked(classify(report(), 0, { stdout }), "JSON");
});
test("AUDIT-11 endpoint error JSON is distinct from findings and schema failure", () => {
  blocked(classify({ error: { code: "endpoint fixture", summary: "do not publish" } }, 1), "ENDPOINT");
});
test("AUDIT-12 audit schema version, exact record keys and counter types are enforced", () => {
  const fixtures = [() => ({ ...report(), auditReportVersion: 1 }), () => ({ ...report(), extra: "raw" }),
    () => { const value = report(); value.metadata.dependencies.total = "2"; return value; },
    () => { const value = report(); value.metadata.dependencies.total = 0; return value; },
    () => { const value = report({ alpha: "low" }); value.vulnerabilities.alpha.newField = true; return value; }];
  for (const create of fixtures) blocked(classify(create()), "SCHEMA");
});
test("AUDIT-13 severity counters and total must match actual vulnerability records", () => {
  for (const change of [(value) => { value.metadata.vulnerabilities.total = 0; },
    (value) => { value.metadata.vulnerabilities.high = 1; }, (value) => { value.metadata.vulnerabilities.low = -1; }]) {
    const value = report({ alpha: "low" }); change(value); blocked(classify(value), "SCHEMA");
  }
});
test("AUDIT-14 vulnerability, via, effects and node identity must exist in this lock", () => {
  const changes = [(item) => { item.name = "unknown"; }, (item) => { item.via = ["unknown"]; },
    (item) => { item.effects = ["unknown"]; }, (item) => { item.nodes = ["node_modules/beta"]; },
    (item) => { item.nodes = ["node_modules/alpha", "node_modules/alpha"]; },
    (item) => { item.via[0].dependency = "unknown"; }];
  for (const change of changes) { const value = report({ alpha: "low" }); change(value.vulnerabilities.alpha); blocked(classify(value), "SCHEMA"); }
});
test("AUDIT-15 only validated official advisory IDs and numeric sources are exposed", () => {
  for (const url of ["https://attacker.invalid/GHSA-2345-6789-cfgh", "https://github.com/advisories/not-an-id", "https://github.com/advisories/GHSA-2345-6789-cfgh?token=raw"]) {
    const value = report({ alpha: "low" }); value.vulnerabilities.alpha.via[0].url = url; blocked(classify(value), "SCHEMA");
  }
  const value = report({ alpha: "low" });
  value.vulnerabilities.alpha.via[0].url = "https://nvd.nist.gov/vuln/detail/CVE-2026-12345";
  assert.deepEqual(classify(value).advisoryIds, ["CVE-2026-12345"]);
  value.vulnerabilities.alpha.via[0].source = "1234567";
  blocked(classify(value), "SCHEMA");
});
test("AUDIT-16 fix metadata and trusted npm version must have safe exact shapes", () => {
  for (const version of ["11.6.2\n", "11.6.2\nraw", "11.6.2-beta", "https://example.invalid", undefined]) assert.throws(() => npmVersion(version));
  assert.equal(npmVersion(VERSION), VERSION);
  const value = report({ alpha: "low" }); value.vulnerabilities.alpha.fixAvailable.version = "file:secret";
  blocked(classify(value), "SCHEMA");
});
test("AUDIT-17 COMPLETE requires unchanged hashes, no children, sealed network and exact cleanup", () => {
  const summary = classify(report());
  assert.equal(confirmCompletion(summary, evidence(), expected, VERSION), summary);
  const changes = { packageSha256: "c".repeat(64), lockSha256: "c".repeat(64), children: 1,
    preflight: false, networkSealed: false, running: false, oomKilled: true, cleaned: false };
  for (const [key, value] of Object.entries(changes)) assert.throws(() => confirmCompletion(summary, { ...evidence(), [key]: value }, expected, VERSION));
});
test("AUDIT-18 sanitized summary rejects invented reasons, fields, IDs and count drift", () => {
  const changes = [(value) => { value.reason = "arbitrary raw error"; }, (value) => { value.path = "/private"; },
    (value) => { value.npmVersion = "1.0.0"; }, (value) => { value.vulnerabilities.total++; },
    (value) => { value.advisoryIds = ["CVE-bad"]; }, (value) => { value.sourceIds = ["raw"]; }];
  for (const change of changes) { const value = classify(report({ alpha: "low" })); change(value); assert.throws(() => validateSummary(value, VERSION)); }
});
test("AUDIT-19 contradictory advisory and linked-record severities are blocked", () => {
  const direct = report({ alpha: "low" });
  direct.vulnerabilities.alpha.via[0].severity = "critical";
  blocked(classify(direct), "SCHEMA");
  const linked = report({ alpha: "low", beta: "high" });
  linked.vulnerabilities.alpha.via = ["beta"];
  blocked(classify(linked, 1), "SCHEMA");
  const absent = report({ alpha: "low" });
  absent.vulnerabilities.alpha.via.push("beta");
  blocked(classify(absent), "SCHEMA");
});
