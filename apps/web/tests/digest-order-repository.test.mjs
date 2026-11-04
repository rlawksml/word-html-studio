import assert from "node:assert/strict";
import test from "node:test";
import { createDigestOrderRepository } from "../lib/digest-order-repository.ts";
import { DIGEST_ORDER_SCHEMA_VERSION } from "../scripts/supabase-schema.mjs";

const month = "2026-11";
const hash = "c".repeat(64);
const request = { month, submissionIds: [2, 1], revision: 0 };
const marker = { data: { component: "digest_order", version: DIGEST_ORDER_SCHEMA_VERSION }, error: null };
const row = (changes = {}) => ({ month, submission_ids: [2, 1], revision: 1, updated_at: "2026-11-04T10:00:00.123456+00:00", ...changes });
const noMarker = { data: null, error: null };

function mockClient({ schema = marker, record = { data: row(), error: null }, rpc = { data: row(), error: null } } = {}) {
  const calls = [];
  const client = {
    from(table) {
      assert.ok(["app_schema_versions", "monthly_digest_orders"].includes(table));
      const call = { table, filters: [] }; calls.push(call);
      return {
        select(columns) { call.columns = columns; return this; },
        eq(key, value) { call.filters.push([key, value]); return this; },
        maybeSingle() { return Promise.resolve(table === "app_schema_versions" ? structuredClone(schema) : structuredClone(record)); },
      };
    },
    rpc(name, args) {
      calls.push({ rpc: name, args: structuredClone(args) });
      return { maybeSingle: () => Promise.resolve(structuredClone(rpc)) };
    },
  };
  return { client, calls };
}

const code = (expected) => (error) => error.code === expected && !String(error.message).includes("PRIVATE");

test("DORDER-REPO-01 정확한 component marker만 읽고 없는 marker는 미설치", async () => {
  const { client, calls } = mockClient({ schema: noMarker });
  assert.deepEqual(await createDigestOrderRepository(client).read(month), { available: false });
  assert.deepEqual(calls, [{ table: "app_schema_versions", columns: "component,version", filters: [["component", "digest_order"]] }]);
});

test("DORDER-REPO-02 legacy marker 테이블의 정확한 부재만 미설치로 인정한다", async () => {
  for (const error of [{ code: "PGRST205", message: "Could not find the table 'public.app_schema_versions' in the schema cache" },
    { code: "42P01", message: 'relation "public.app_schema_versions" does not exist' }]) {
    const { client, calls } = mockClient({ schema: { data: null, error } });
    assert.deepEqual(await createDigestOrderRepository(client).read(month), { available: false });
    assert.equal(calls.length, 1);
  }
});

test("DORDER-REPO-03 권한/네트워크/다른 table 오류는 미설치가 아닌503 고정오류", async () => {
  for (const error of [{ code: "42501", message: "PRIVATE permission" }, { code: "PGRST303", message: "PRIVATE JWT" },
    { code: "PGRST205", message: "Could not find the table 'public.monthly_digest_orders' in the schema cache" },
    { code: "42P01", message: 'relation "public.other" does not exist' }]) {
    const { client } = mockClient({ schema: { data: null, error } });
    await assert.rejects(createDigestOrderRepository(client).read(month), code("DIGEST_ORDER_STORAGE_FAILED"));
  }
  const { client } = mockClient();
  client.from = () => { throw new Error("PRIVATE_NETWORK"); };
  await assert.rejects(createDigestOrderRepository(client).read(month), code("DIGEST_ORDER_STORAGE_FAILED"));
});

test("DORDER-REPO-04 marker 불일치/미래version은 schema error이며 order table 비조회", async () => {
  for (const data of [{ component: "digest_order", version: DIGEST_ORDER_SCHEMA_VERSION + 1 },
    { component: "workspace", version: DIGEST_ORDER_SCHEMA_VERSION }, { component: "digest_order", version: String(DIGEST_ORDER_SCHEMA_VERSION) }]) {
    const { client, calls } = mockClient({ schema: { data, error: null } });
    await assert.rejects(createDigestOrderRepository(client).read(month), code("DIGEST_ORDER_SCHEMA_MISMATCH"));
    assert.equal(calls.length, 1);
  }
});

test("DORDER-REPO-05 marker 설치/빈 table은 명시적 rev0 sentinel", async () => {
  const { client, calls } = mockClient({ record: { data: null, error: null } });
  assert.deepEqual(await createDigestOrderRepository(client).read(month), { available: true, order: { month, submissionIds: [], revision: 0, updatedAt: "" } });
  assert.deepEqual(calls[1].filters, [["month", month]]);
  assert.equal(calls[1].columns, "month,submission_ids,revision,updated_at");
});

test("DORDER-REPO-06 marker가 있는데 table 부재/권한/잘못된 row는 오류", async () => {
  for (const record of [{ data: null, error: { code: "PGRST205", message: "PRIVATE missing table" } },
    { data: row({ month: "2026-12" }), error: null }, { data: row({ submission_ids: [1, 1] }), error: null },
    { data: undefined, error: null }]) {
    const { client } = mockClient({ record });
    await assert.rejects(createDigestOrderRepository(client).read(month), code("DIGEST_ORDER_STORAGE_FAILED"));
  }
});

test("DORDER-REPO-07 save는 exact RPC와 server hash/CAS만 전달한다", async () => {
  const { client, calls } = mockClient();
  const result = await createDigestOrderRepository(client).save(request, hash);
  assert.deepEqual(result, { month, submissionIds: [2, 1], revision: 1, updatedAt: row().updated_at });
  assert.deepEqual(calls[1], { rpc: "save_monthly_digest_order", args: {
    p_month: month, p_submission_ids: [2, 1], p_expected_revision: 0, p_session_hash: hash,
  } });
  assert.equal(calls.filter((call) => call.rpc).length, 1);
  assert.ok(calls.every((call) => !["submissions", "bookstores", "editing_leases"].includes(call.table)));
});

test("DORDER-REPO-08 잘못된 payload/hash와 미설치에서는 RPC0회", async () => {
  const { client, calls } = mockClient({ schema: noMarker });
  const repository = createDigestOrderRepository(client);
  await assert.rejects(repository.save({ ...request, submissionIds: [1, 1] }, hash));
  await assert.rejects(repository.save(request, "PRIVATE_INVALID_HASH"), code("INVALID_DIGEST_ORDER"));
  await assert.rejects(repository.save(request, `${hash}\n`), code("INVALID_DIGEST_ORDER"));
  await assert.rejects(repository.save(request, hash), code("DIGEST_ORDER_UNAVAILABLE"));
  assert.equal(calls.filter((call) => call.rpc).length, 0);
});

test("DORDER-REPO-09 SQL의 고정 lease/validation 코드를 매핑한다", async () => {
  for (const [sqlCode, publicCode] of [["PDL01", "DIGEST_ORDER_LEASE_REQUIRED"], ["PDI01", "INVALID_DIGEST_ORDER"]]) {
    const { client, calls } = mockClient({ rpc: { data: null, error: { code: sqlCode, message: "PRIVATE_SQL_HASH" } } });
    await assert.rejects(createDigestOrderRepository(client).save(request, hash), code(publicCode));
    assert.equal(calls.filter((call) => call.rpc).length, 1);
  }
});

test("DORDER-REPO-10 CAS conflict는 읽기만 추가하고 최신순서를 전달한다", async () => {
  const { client, calls } = mockClient({ rpc: { data: null, error: { code: "PDC01", message: "PRIVATE_SQL" } } });
  await assert.rejects(createDigestOrderRepository(client).save(request, hash), (error) => {
    assert.equal(error.code, "DIGEST_ORDER_CONFLICT");
    assert.deepEqual(error.latest.submissionIds, [2, 1]);
    return true;
  });
  assert.equal(calls.filter((call) => call.rpc).length, 1);
  assert.equal(calls.filter((call) => call.table === "monthly_digest_orders").length, 1);
});

test("DORDER-REPO-11 일반 오류/유실 응답은 blind RPC 재시도 없이 고정오류", async () => {
  for (const rpc of [{ data: null, error: { code: "500", message: "PRIVATE_DB_ERROR" } },
    { data: null, error: { code: "PGRST202", message: "PRIVATE_RPC_MISSING" } }, { data: null, error: null }]) {
    const { client, calls } = mockClient({ rpc });
    await assert.rejects(createDigestOrderRepository(client).save(request, hash), code("DIGEST_ORDER_STORAGE_FAILED"));
    assert.equal(calls.filter((call) => call.rpc).length, 1);
  }
});

test("DORDER-REPO-12 execute port는 주입되지만 repository가 자체 재시도하지 않는다", async () => {
  const { client } = mockClient();
  let executions = 0;
  const execute = async (operation) => { executions++; return operation(); };
  await createDigestOrderRepository(client, execute).save(request, hash);
  assert.equal(executions, 2); // marker1 + RPC1. retryFutureJwt 자체는 기존 서버 경계입니다.
});

test("DORDER-REPO-13 MAX_SAFE expected revision은 marker·RPC 조회 전400", async () => {
  const { client, calls } = mockClient();
  await assert.rejects(createDigestOrderRepository(client).save({ ...request, revision: Number.MAX_SAFE_INTEGER }, hash), code("INVALID_DIGEST_ORDER"));
  assert.deepEqual(calls, []);
});

test("DORDER-REPO-14 성공 RPC도 요청 IDs·정확+1 revision 불일치는 고정오류·재시도없음", async () => {
  const requested = { ...request, revision: 2 };
  const invalid = [
    row({ submission_ids: [1, 2], revision: 3 }),
    row({ submission_ids: [2], revision: 3 }),
    row({ submission_ids: [2, 1, 3], revision: 3 }),
    row({ submission_ids: [], revision: 0, updated_at: "" }),
    ...[1, 2, 4, Number.MAX_SAFE_INTEGER].map((revision) => row({ revision })),
    row({ month: "2026-12", revision: 3 }),
  ];
  for (const data of invalid) {
    const { client, calls } = mockClient({ rpc: { data, error: null } });
    await assert.rejects(createDigestOrderRepository(client).save(requested, hash), code("DIGEST_ORDER_STORAGE_FAILED"));
    assert.equal(calls.filter((call) => call.rpc).length, 1);
    assert.equal(calls.filter((call) => call.table === "monthly_digest_orders").length, 0);
  }
});

test("DORDER-REPO-15 비초기·마지막 안전 revision 및 빈 ID 저장은 정확+1만 인정", async () => {
  for (const [revision, submissionIds] of [[3, [2, 1]], [Number.MAX_SAFE_INTEGER - 1, [2, 1]], [2, []]]) {
    const requested = { ...request, revision, submissionIds };
    const data = row({ revision: revision + 1, submission_ids: submissionIds });
    const { client, calls } = mockClient({ rpc: { data, error: null } });
    assert.deepEqual(await createDigestOrderRepository(client).save(requested, hash), {
      month, submissionIds, revision: revision + 1, updatedAt: data.updated_at,
    });
    assert.equal(calls.filter((call) => call.rpc).length, 1);
    assert.equal(calls[1].args.p_expected_revision, revision);
  }
});
