import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertStagingRestoreTarget, canonicalJson, planTableRestore, projectFingerprint, sha256 } from "../scripts/backup-utils.mjs";
import { SCHEMA_MARKER_TABLE, planSchemaMarkerRestore, verifySchemaMarkerRestore } from "../scripts/schema-marker-restore-policy.mjs";
import { tableSpecsForRestore } from "../scripts/supabase-schema.mjs";

const sourceStamp = "2026-09-07T01:02:03.123456+00:00";
const targetStamp = "2026-11-05T01:02:03.123Z";
const row = (changes = {}) => ({ component: "workspace", version: 202609070002, applied_at: sourceStamp, ...changes });
const source = () => [row(), row({ component: "digest_order", version: 202611040001 })];
const target = () => source().map((item) => ({ ...item, applied_at: targetStamp }));
const plan = (sourceRows = source(), currentRows = target()) => planSchemaMarkerRestore({ sourceRows, currentRows });
const clone = (value) => structuredClone(value);
const restoreArgs = (changes = {}) => ({ appEnv: "staging", supabaseUrl: "https://restore-fixture.supabase.co",
  expectedProjectRef: "restore-fixture", confirmedProjectRef: "restore-fixture", sourceProjectFingerprint: "1".repeat(16), ...changes });

// 실제 SDK/CLI 진입은 실행하지 않습니다. 검토한 insert loop만 메모리 port로 실행합니다.
async function insertLoop() {
  const script = await readFile(new URL("../scripts/supabase-restore-staging.mjs", import.meta.url), "utf8");
  const start = script.indexOf("for (const table of tableOrder) {\n  if (table === SCHEMA_MARKER_TABLE) continue;");
  const end = script.indexOf("\nfunction contentTypeFor", start);
  assert.ok(start >= 0 && end > start, "reviewed insert loop boundaries must exist");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction("tableOrder", "tablePlans", "client", "SCHEMA_MARKER_TABLE", script.slice(start, end));
}

test("RESTORE-MARKER-01 same component/version with different applied_at preserves target without writes", () => {
  const current = target(), selected = plan(source(), current);
  assert.deepEqual(selected, { action: "preserve", rows: [], components: 2 });
  assert.equal(verifySchemaMarkerRestore({ plan: selected, currentRows: current }).mode, "preserved-target-markers");
});

test("RESTORE-MARKER-02 exact rows also preserve; source/target inputs remain byte-identical", () => {
  const expected = source(), current = clone(expected), before = canonicalJson({ expected, current });
  const selected = plan(expected, current);
  verifySchemaMarkerRestore({ plan: selected, currentRows: current });
  assert.equal(canonicalJson({ expected, current }), before);
});

test("RESTORE-MARKER-03 comparison is semantic across row/key order but target snapshot retains raw order", () => {
  const expected = source(), current = target().reverse().map(({ applied_at, version, component }) => ({ applied_at, version, component }));
  const selected = plan(expected, current);
  assert.equal(verifySchemaMarkerRestore({ plan: selected, currentRows: current }).targetSha256, sha256(canonicalJson(current)));
});

test("RESTORE-MARKER-04 empty/missing/non-array rows fail closed", () => {
  for (const invalid of [[], null, undefined, {}, "rows"]) {
    assert.throws(() => planSchemaMarkerRestore({ sourceRows: invalid, currentRows: target() }), /INVALID_ROWS/);
    assert.throws(() => planSchemaMarkerRestore({ sourceRows: source(), currentRows: invalid }), /INVALID_ROWS/);
  }
});

test("RESTORE-MARKER-05 added/missing/different components and higher/lower versions are rejected", () => {
  for (const current of [target().slice(1), [...target(), row({ component: "future" })],
    [row({ component: "other" }), target()[1]], target().map((item) => ({ ...item, version: item.version + 1 })),
    target().map((item) => ({ ...item, version: item.version - 1 }))]) assert.throws(() => plan(source(), current), /SCHEMA_MISMATCH/);
});

test("RESTORE-MARKER-06 duplicates/malformed components/versions/unknown fields are not normalized", () => {
  const variants = [row({ component: "workspace\n" }), row({ component: "workspace\r" }), row({ component: "WORKSPACE" }),
    row({ component: "" }), row({ component: 1 }), row({ component: "x".repeat(65) }),
    row({ version: 0 }), row({ version: -1 }), row({ version: 1.1 }), row({ version: "202609070002" }),
    row({ version: Number.MAX_SAFE_INTEGER + 1 }), row({ future: true })];
  for (const value of variants) assert.throws(() => plan([value], [value]), /INVALID_ROWS/);
  assert.throws(() => plan([row(), row()], target()), /INVALID_ROWS/);
  assert.throws(() => plan(source(), [row(), row()]), /INVALID_ROWS/);
});

test("RESTORE-MARKER-07 timestamps require valid calendar/time/offset strings", () => {
  for (const applied_at of [null, 1, "", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00+24:00", `${sourceStamp}\n`]) {
    assert.throws(() => plan([row({ applied_at })], [row({ applied_at })]), /INVALID_ROWS/);
  }
  const leap = [row({ applied_at: "2028-02-29T23:59:59.123456+09:00" })];
  assert.equal(plan(leap, leap).components, 1);
});

test("RESTORE-MARKER-08 rows are bounded at32 and dense plain data only", () => {
  const full = Array.from({ length: 32 }, (_, index) => row({ component: `c${index}` }));
  assert.equal(plan(full, full).components, 32);
  assert.throws(() => plan([...full, row({ component: "extra" })], full), /INVALID_ROWS/);
  const sparse = Array(1), withExtra = [row()]; withExtra.extra = true;
  const symbolArray = [row()]; symbolArray[Symbol("extra")] = true;
  const hiddenRow = row(); Object.defineProperty(hiddenRow, "version", { value: 1, enumerable: false });
  const hiddenIndex = [row()]; Object.defineProperty(hiddenIndex, "0", { value: row(), enumerable: false });
  class Row { constructor() { Object.assign(this, row()); } }
  for (const rows of [sparse, withExtra, symbolArray, [hiddenRow], hiddenIndex, [new Row()], [new Date()], [null]]) assert.throws(() => plan(rows, rows), /INVALID_ROWS/);
});

test("RESTORE-MARKER-09 array/row accessors are refused without invoking getters", () => {
  let reads = 0;
  const accessorRow = row();
  Object.defineProperty(accessorRow, "component", { get() { reads++; return "workspace"; }, enumerable: true });
  const accessorArray = [row()];
  Object.defineProperty(accessorArray, "0", { get() { reads++; return row(); }, enumerable: true });
  assert.throws(() => plan([accessorRow], target()), /INVALID_ROWS/);
  assert.throws(() => plan(accessorArray, target()), /INVALID_ROWS/);
  assert.equal(reads, 0);
});

test("RESTORE-MARKER-10 plans are immutable, opaque and defensive snapshots", () => {
  const expected = source(), current = target(), before = clone(current), selected = plan(expected, current);
  assert.equal(Object.isFrozen(selected), true); assert.equal(Object.isFrozen(selected.rows), true);
  expected[0].version++; current[0].applied_at = sourceStamp;
  assert.equal(verifySchemaMarkerRestore({ plan: selected, currentRows: before }).components, 2);
  for (const fake of [undefined, null, {}, { ...selected }, clone(selected)]) {
    assert.throws(() => verifySchemaMarkerRestore({ plan: fake, currentRows: before }), /INVALID_PLAN/);
  }
});

test("RESTORE-MARKER-11 final verification detects timestamp/key order/row order drift and version changes", () => {
  const current = target(), selected = plan(source(), current);
  const variants = [current.map((item) => ({ ...item, applied_at: sourceStamp })), clone(current).reverse(),
    current.map(({ component, version, applied_at }) => ({ version, component, applied_at }))];
  for (const rows of variants) assert.throws(() => verifySchemaMarkerRestore({ plan: selected, currentRows: rows }), /TARGET_CHANGED/);
  assert.throws(() => verifySchemaMarkerRestore({ plan: selected,
    currentRows: current.map((item) => ({ ...item, version: item.version + 1 })) }), /SCHEMA_MISMATCH/);
});

test("RESTORE-MARKER-12 business table empty/resume rules and legacy table list remain unchanged", () => {
  const expectedRows = [{ id: 1, name: "fixture" }], expectedSha256 = sha256(canonicalJson(expectedRows));
  assert.equal(planTableRestore({ table: "bookstores", currentRows: [], expectedRows, expectedSha256, allowResume: false }).action, "insert");
  assert.equal(planTableRestore({ table: "bookstores", currentRows: clone(expectedRows), expectedRows, expectedSha256, allowResume: true }).action, "skip");
  assert.throws(() => planTableRestore({ table: "bookstores", currentRows: [{ id: 1, name: "changed" }], expectedRows, expectedSha256, allowResume: true }), /hash mismatch/);
  assert.throws(() => planTableRestore({ table: "bookstores", currentRows: expectedRows, expectedRows, expectedSha256, allowResume: false }), /non-empty/);
  const legacy = tableSpecsForRestore({ bookstores: {}, submissions: {}, editing_leases: {}, improvement_requests: {} });
  assert.equal(legacy.some((table) => table.name === SCHEMA_MARKER_TABLE), false);
});

test("RESTORE-MARKER-13 actual insert loop skips marker even if a forged plan carries rows", async () => {
  const run = await insertLoop(), calls = [];
  const client = { from(table) {
    calls.push(table); assert.notEqual(table, SCHEMA_MARKER_TABLE);
    return { insert: async (rows) => { assert.deepEqual(rows, [{ id: 1 }]); return { error: null }; } };
  } };
  await run([SCHEMA_MARKER_TABLE, "bookstores"], {
    [SCHEMA_MARKER_TABLE]: { rows: [row()] }, bookstores: { rows: [{ id: 1 }] },
  }, client, SCHEMA_MARKER_TABLE);
  assert.deepEqual(calls, ["bookstores"]);
});

test("RESTORE-MARKER-14 insert loop stops on first business failure without cleanup or later writes", async () => {
  const run = await insertLoop(), calls = [];
  const client = { from(table) { calls.push(table); return { insert: async () => ({ error: { message: "synthetic failure" } }) }; } };
  await assert.rejects(run(["bookstores", SCHEMA_MARKER_TABLE, "submissions"], {
    bookstores: { rows: [{ id: 1 }] }, [SCHEMA_MARKER_TABLE]: plan(), submissions: { rows: [{ id: 2 }] },
  }, client, SCHEMA_MARKER_TABLE), /Restore failed for bookstores/);
  assert.deepEqual(calls, ["bookstores"]);
});

test("RESTORE-MARKER-15 CLI connects planning, prewrite and final verification without changing backup bytes", async () => {
  const script = await readFile(new URL("../scripts/supabase-restore-staging.mjs", import.meta.url), "utf8");
  assert.match(script, /planSchemaMarkerRestore\(\{ sourceRows: tableRows\[table\], currentRows \}\)/);
  assert.match(script, /schemaMarkerVerification = verifySchemaMarkerRestore\(\{ plan: tablePlans\[table\], currentRows: rows \}\)/);
  const prewriteMarkerCheck = script.match(/^if \(tablePlans\[SCHEMA_MARKER_TABLE\]\) \{\s+verifySchemaMarkerRestore\(\{ plan: tablePlans\[SCHEMA_MARKER_TABLE\],\s+currentRows: await selectAll\(SCHEMA_MARKER_TABLE, orderColumns\[SCHEMA_MARKER_TABLE\]\) \}\);\s+\}/m);
  assert.ok(prewriteMarkerCheck, "actual marker-plan condition must invoke target marker verification");
  const businessInsert = script.indexOf("await client.from(table).insert");
  assert.ok(businessInsert >= 0 && prewriteMarkerCheck.index + prewriteMarkerCheck[0].length < businessInsert,
    "conditional target marker verification must finish before the first business insert");
  assert.match(script, /schemaCompatibility: "NOT_VERIFIED"/);
  assert.match(script, /if \(sha256\(payload\) !== verification\.manifest\.database\[table\]\.sha256\)/);
  assert.doesNotMatch(script, /writeFile|\.upsert\(|\.delete\(|\.remove\(/);
});

test("RESTORE-TARGET-01 known Production and retained Staging refs cannot be confirmation-overridden", () => {
  for (const ref of ["kdigttaghqubfjsmbngl", "kriyjyyudngtibrtkylf"]) {
    assert.throws(() => assertStagingRestoreTarget(restoreArgs({ supabaseUrl: `https://${ref}.supabase.co`,
      expectedProjectRef: ref, confirmedProjectRef: ref })), /protected project/);
  }
});

test("RESTORE-TARGET-02 source fingerprint must be an explicit valid16hex value", () => {
  for (const value of [undefined, null, "", 1, "source", "A".repeat(16), `${"a".repeat(16)}\n`]) {
    assert.throws(() => assertStagingRestoreTarget(restoreArgs({ sourceProjectFingerprint: value })), /source project fingerprint/);
  }
});

test("RESTORE-TARGET-03 same source project and mismatched operator confirmations stay blocked", () => {
  const args = restoreArgs();
  assert.throws(() => assertStagingRestoreTarget({ ...args, sourceProjectFingerprint: projectFingerprint(args.supabaseUrl) }), /backup source project/);
  assert.throws(() => assertStagingRestoreTarget({ ...args, expectedProjectRef: "other" }), /EXPECTED_STAGING_PROJECT_REF/);
  assert.throws(() => assertStagingRestoreTarget({ ...args, confirmedProjectRef: "other" }), /CONFIRM_STAGING_PROJECT_REF/);
  assert.throws(() => assertStagingRestoreTarget({ ...args, appEnv: "production" }), /APP_ENV=staging/);
});

test("RESTORE-TARGET-04 only canonical HTTPS official root URLs are accepted", () => {
  for (const value of ["http://restore-fixture.supabase.co", "https://user:synthetic@restore-fixture.supabase.co",
    "https://restore-fixture.supabase.co:444", "https://restore-fixture.supabase.co:443", "https://restore-fixture.supabase.co/rest/v1",
    "https://restore-fixture.supabase.co/?q=1", "https://restore-fixture.supabase.co/#fragment", "https://restore-fixture.example.org"]) {
    assert.throws(() => assertStagingRestoreTarget(restoreArgs({ supabaseUrl: value })));
  }
  assert.equal(assertStagingRestoreTarget(restoreArgs({ supabaseUrl: "https://restore-fixture.supabase.co/" })).actualProjectRef, "restore-fixture");
});
