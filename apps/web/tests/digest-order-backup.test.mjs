import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DIGEST_ORDER_SCHEMA_VERSION, readSupabaseSchemaCapabilities,
  isMissingSchemaVersionTableError, tableSpecsForBackup, tableSpecsForRestore,
} from "../scripts/supabase-schema.mjs";
import { canonicalJson } from "../scripts/backup-utils.mjs";
import { validateMigrationDirectory, findForbiddenMigrationStatements } from "../scripts/migration-policy.mjs";

const base = ["bookstores", "submissions", "editing_leases", "improvement_requests"];
const established = [...base, "app_schema_versions", "news_schedule_ranges"];
const withDigest = [...established, "monthly_digest_orders"];

function schemaClient(result) {
  return { from(table) {
    assert.equal(table, "app_schema_versions");
    return { select(columns) { assert.equal(columns, "component,version"); return this; },
      eq(key, value) { assert.equal(key, "component"); assert.equal(value, "digest_order"); return this; },
      maybeSingle: async () => structuredClone(result) };
  } };
}

test("DORDER-BACKUP-01 기존 boolean 호출은 기존 table 목록을 그대로 유지한다", () => {
  assert.deepEqual(tableSpecsForBackup(false).map((item) => item.name), base);
  assert.deepEqual(tableSpecsForBackup(true).map((item) => item.name), established);
  assert.deepEqual(tableSpecsForBackup(true, false).map((item) => item.name), established);
  assert.throws(() => tableSpecsForBackup(false, true), /MARKER_REQUIRED/);
  for (const flag of [null, "false", {}]) assert.throws(() => tableSpecsForBackup(true, flag), /FLAGS_INVALID/);
});

test("DORDER-BACKUP-02 별도 component의 실제 설치 확인 후에만 새 table을 포함한다", async () => {
  const absent = await readSupabaseSchemaCapabilities(schemaClient({ data: null, error: null }));
  assert.deepEqual(absent, { schemaVersionAvailable: true, digestOrderAvailable: false });
  assert.deepEqual(tableSpecsForBackup(absent.schemaVersionAvailable, absent.digestOrderAvailable).map((item) => item.name), established);
  const installed = await readSupabaseSchemaCapabilities(schemaClient({ data: { component: "digest_order", version: DIGEST_ORDER_SCHEMA_VERSION }, error: null }));
  assert.deepEqual(tableSpecsForBackup(installed.schemaVersionAvailable, installed.digestOrderAvailable).map((item) => item.name), withDigest);
});

test("DORDER-BACKUP-03 marker table의 정확한 부재만 legacy이며 다른 오류는 숨기지 않는다", async () => {
  const missing = { code: "PGRST205", message: "Could not find the table 'public.app_schema_versions' in the schema cache" };
  assert.equal(isMissingSchemaVersionTableError(missing), true);
  assert.deepEqual(await readSupabaseSchemaCapabilities(schemaClient({ data: null, error: missing })), { schemaVersionAvailable: false, digestOrderAvailable: false });
  for (const error of [{ code: "PGRST205", message: "Could not find the table 'public.monthly_digest_orders' in the schema cache" },
    { code: "42501", message: "PRIVATE_PERMISSION" }, { code: "PGRST205", message: "PRIVATE_UNKNOWN" }]) {
    assert.equal(isMissingSchemaVersionTableError(error), false);
    await assert.rejects(readSupabaseSchemaCapabilities(schemaClient({ data: null, error })), /^Error: SCHEMA_CAPABILITY_QUERY_FAILED$/);
  }
  assert.equal(isMissingSchemaVersionTableError({ ...missing, message: `${missing.message}\n` }), false);
  assert.equal(isMissingSchemaVersionTableError({ ...missing, message: {} }), false);
  await assert.rejects(readSupabaseSchemaCapabilities(schemaClient({ data: { component: "digest_order", version: DIGEST_ORDER_SCHEMA_VERSION + 1 }, error: null })), /SCHEMA_VERSION_UNSUPPORTED/);
});

test("DORDER-BACKUP-04 restore는 새table을 알지만 옛manifest에 table을 추가하지 않는다", () => {
  assert.deepEqual(tableSpecsForRestore(Object.fromEntries(base.map((name) => [name, {}]))).map((item) => item.name), base);
  assert.deepEqual(tableSpecsForRestore(Object.fromEntries(established.map((name) => [name, {}]))).map((item) => item.name), established);
  assert.deepEqual(tableSpecsForRestore(Object.fromEntries(withDigest.map((name) => [name, {}]))).map((item) => item.name), withDigest);
  const futureRows = [{ month: "2026-11", revision: 2, submission_ids: [2, 1], future_metadata: { keep: "opaque" } }];
  const before = canonicalJson(futureRows);
  tableSpecsForRestore({ monthly_digest_orders: { rows: 1, future_manifest_metadata: "keep" } });
  assert.equal(canonicalJson(futureRows), before, "table plan must not normalize raw future row fields");
});

test("DORDER-BACKUP-05 backup source는 설치 gate를 사용하며 table 조회 실패를 계속 실패시킨다", async () => {
  const source = await readFile(new URL("../scripts/supabase-backup.mjs", import.meta.url), "utf8");
  assert.match(source, /readSupabaseSchemaCapabilities\(client\)/);
  assert.match(source, /tableSpecsForBackup\(schemaCapabilities\.schemaVersionAvailable, schemaCapabilities\.digestOrderAvailable\)/);
  assert.match(source, /if \(result\.error\) throw new Error\(`Database export failed/);
  assert.doesNotMatch(source, /await.*\.delete\(/);
});

test("DORDER-SQL-01 migration은 additive transaction/manifest 일치이며 기존 workspace version 불변", async () => {
  const result = await validateMigrationDirectory(new URL("../supabase/migrations/", import.meta.url));
  assert.equal(result.status, "PASS", result.failures.join("\n"));
  const sql = await readFile(new URL("../supabase/migrations/202611040001_monthly_digest_order.sql", import.meta.url), "utf8");
  assert.deepEqual(findForbiddenMigrationStatements(sql), []);
  assert.match(sql, /\bbegin;/);
  assert.match(sql, /\bcommit;/);
  assert.match(sql, /values \('digest_order', 202611040001/);
  assert.doesNotMatch(sql, /values \('workspace'/);
  assert.doesNotMatch(sql, /update public\.(?:submissions|bookstores|news_schedule_ranges|editing_leases)\s+set/i);
  assert.doesNotMatch(sql, /on delete cascade/i);
});

test("DORDER-SQL-02 precondition은 함수 교체 전에 base/미래 component를 거부한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202611040001_monthly_digest_order.sql", import.meta.url), "utf8");
  assert.ok(sql.indexOf("digest_version <> 202611040001") < sql.indexOf("create or replace function"));
  assert.match(sql, /workspace_version < 202609070002/);
  assert.match(sql, /pg_advisory_xact_lock\(20261104, 1\)/);
  assert.ok(sql.indexOf("DIGEST_ORDER_UNOWNED_SCHEMA_OBJECTS") < sql.indexOf("create or replace function"));
  assert.ok(sql.indexOf("DIGEST_ORDER_SCHEMA_OBJECTS_MISSING") < sql.indexOf("create or replace function"));
  assert.match(sql, /digest_version is null and \(order_table is not null or ids_function is not null or save_function is not null\)/);
  assert.match(sql, /digest_version is not null and \(order_table is null or ids_function is null or save_function is null\)/);
});

test("DORDER-SQL-03 RPC의 lease rowlock·role/hash/expiry·동일월·CAS 소스 경계를 확인한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202611040001_monthly_digest_order.sql", import.meta.url), "utf8");
  assert.match(sql, /where lease\.resource_key = 'digest:' \|\| p_month\s+for update/);
  assert.match(sql, /current_lease\.role is distinct from 'html'/);
  assert.match(sql, /current_lease\.session_hash is distinct from p_session_hash/);
  assert.match(sql, /current_lease\.expires_at <= clock_timestamp\(\)/);
  assert.match(sql, /submission\.month <> p_month/);
  assert.match(sql, /target\.month = p_month and target\.revision = p_expected_revision/);
  assert.match(sql, /errcode = 'PDC01'/);
  assert.match(sql, /revoke all on function public\.save_monthly_digest_order[^;]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.save_monthly_digest_order[^;]+to service_role/);
  assert.match(sql, /alter table public\.monthly_digest_orders enable row level security/);
  // 소스 계약 검사일 뿐 실제 Postgres lock/CAS/권한 실행 증거는 아닙니다.
});

test("DORDER-SQL-04 ID 잠금 수는 JOIN 월검사·CAS 전에 전체 요청 수와 일치해야 한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202611040001_monthly_digest_order.sql", import.meta.url), "utf8");
  assert.match(sql, /locked_count integer;/);
  assert.match(sql, /order by submission\.id\s+for share;\s+--[^\n]*\n\s*get diagnostics locked_count = row_count;/);
  assert.match(sql, /if locked_count <> cardinality\(p_submission_ids\) then\s+raise exception using errcode = 'PDI01'/);
  const countCheck = sql.indexOf("if locked_count <> cardinality(p_submission_ids)");
  assert.ok(countCheck > sql.indexOf("get diagnostics locked_count = row_count"));
  assert.ok(countCheck < sql.indexOf("left join public.submissions"));
  assert.ok(countCheck < sql.indexOf("if p_expected_revision = 0 then"));
  // 정적 source assertion이며 실제 concurrent insert/Postgres 실행 증거가 아닙니다.
});
