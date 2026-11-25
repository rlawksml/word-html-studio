import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDigestOrderHandlers, DigestOrderOperationError } from "../lib/digest-order-service.ts";

const month = "2026-11";
const timestamp = "2026-11-04T10:00:00.123456+00:00";
const payload = (changes = {}) => ({ month, submissionIds: [2, 1], revision: 0, ...changes });
const saved = (changes = {}) => ({ month, submissionIds: [2, 1], revision: 1, updatedAt: timestamp, ...changes });
const hash = "a".repeat(64); // 합성 fingerprint. 실제 세션/서명 cookie를 사용하지 않습니다.

function request(method = "GET", body = payload(), query = `month=${month}`, headers = {}) {
  return new Request(`https://digest-order.fixture.invalid/api/digest-order?${query}`, {
    method, headers: { ...(method === "PUT" ? { "content-type": "application/json" } : {}), ...headers },
    ...(method === "PUT" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

function fixture(overrides = {}) {
  const calls = { authorize: 0, fingerprint: 0, getStore: 0, read: 0, save: 0 };
  const store = {
    async read(selectedMonth) { calls.read++; assert.equal(selectedMonth, month); return { available: true, order: saved() }; },
    async save(value, fingerprint) { calls.save++; assert.deepEqual(value, payload()); assert.equal(fingerprint, hash); return saved(); },
    ...overrides.store,
  };
  const handlers = createDigestOrderHandlers({
    authorize: async () => { calls.authorize++; return overrides.role === undefined ? "html" : overrides.role; },
    fingerprint: async () => { calls.fingerprint++; return overrides.hash ?? hash; },
    getStore: () => { calls.getStore++; return store; },
    ...(overrides.readJson ? { readJson: overrides.readJson } : {}),
  });
  return { calls, handlers };
}

test("DORDER-API-01 미인증/HTML 외 역할은 본문·fingerprint·store 전에401/403", async () => {
  for (const [role, status] of [[null, 401], ["input", 403], ["unexpected-role", 403]]) {
    for (const method of ["GET", "PUT"]) {
      let reads = 0;
      const { handlers, calls } = fixture({ role, readJson: async () => { reads++; throw new Error("must not read"); } });
      const response = await handlers[method](request(method));
      assert.equal(response.status, status);
      assert.equal(reads, 0);
      assert.equal(calls.getStore, 0);
      assert.equal(calls.fingerprint, 0);
      assert.equal(response.headers.has("set-cookie"), false);
    }
  }
});

test("DORDER-API-02 query 월 누락/중복/다른 query/잘못된 형식은400이고store 비호출", async () => {
  for (const query of ["", "month=2026-13", "month=2026-11%0A", "month=2026-11&month=2026-12", "month=2026-11&token=x"]) {
    const { handlers, calls } = fixture();
    assert.equal((await handlers.GET(request("GET", undefined, query))).status, 400);
    assert.equal(calls.getStore, 0);
  }
});

test("DORDER-API-03 GET은 no-store·nosniff 및 동일월 record만 반환한다", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { available: true, order: saved() });
  assert.equal(calls.read, 1);
  assert.equal(calls.save, 0);
  assert.equal(calls.fingerprint, 0);
});

test("DORDER-API-04 명시적 capability 미설치와 설치 후 빈 table은 구분한다", async () => {
  for (const capability of [{ available: false }, { available: true, order: saved({ submissionIds: [], revision: 0, updatedAt: "" }) }]) {
    const { handlers } = fixture({ store: { read: async () => capability } });
    const response = await handlers.GET(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), capability);
  }
});

test("DORDER-API-05 malformed/다른월 store 응답은 false capability로 숨기지 않는다", async () => {
  for (const value of [null, {}, { available: false, error: "unconfirmed" }, { available: true, order: saved({ month: "2026-12" }) }]) {
    const { handlers } = fixture({ store: { read: async () => value } });
    const response = await handlers.GET(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "DIGEST_ORDER_STORAGE_FAILED");
  }
});

test("DORDER-API-06 PUT은 strict payload와 서버 fingerprint만 port에 보낸다", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.PUT(request("PUT"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: true, order: saved() });
  assert.equal(calls.save, 1);
  assert.equal(calls.read, 0);
  assert.equal(calls.fingerprint, 1);
});

test("DORDER-API-07 body의 외부월/중복ID/추가session_hash 등은400이며store 비호출", async () => {
  for (const body of [payload({ month: "2026-12" }), payload({ submissionIds: [1, 1] }),
    payload({ revision: -1 }), { ...payload(), p_session_hash: "b".repeat(64) }, { month }]) {
    const { handlers, calls } = fixture();
    const response = await handlers.PUT(request("PUT", body));
    assert.equal(response.status, 400);
    assert.equal(calls.getStore, 0);
    assert.equal(calls.fingerprint, 0);
  }
});

test("DORDER-API-08 잘못된 JSON/type 및 body stream 오류는400 고정오류", async () => {
  const { handlers, calls } = fixture();
  assert.equal((await handlers.PUT(request("PUT", "not-json"))).status, 400);
  assert.equal((await handlers.PUT(request("PUT", payload(), `month=${month}`, { "content-type": "text/plain" }))).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE_BODY_ERROR")); } });
  const response = await handlers.PUT(new Request(`https://digest-order.fixture.invalid/api/digest-order?month=${month}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: stream, duplex: "half",
  }));
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("PRIVATE_BODY_ERROR"));
  assert.equal(calls.getStore, 0);
});

test("DORDER-API-09 Content-Length가없거나거짓이어도 실제64KiB 초과는413", async () => {
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "9999999" }]) {
    const { handlers, calls } = fixture();
    const response = await handlers.PUT(request("PUT", "x".repeat(65_537), `month=${month}`, headers));
    assert.equal(response.status, 413);
    assert.equal(calls.getStore, 0);
  }
});

test("DORDER-API-10 서버 fingerprint 실패는 저장하지 않고 raw값을 반환하지 않는다", async () => {
  for (const fingerprint of ["PRIVATE_FINGERPRINT_ERROR", `${hash}\n`]) {
    const { handlers, calls } = fixture({ hash: fingerprint });
    const response = await handlers.PUT(request("PUT"));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("PRIVATE_FINGERPRINT_ERROR"));
    assert.equal(calls.getStore, 0);
  }
});

test("DORDER-API-11 typed conflict는409와 검증된latest만 반환하고 재저장하지 않는다", async () => {
  for (const latest of [saved({ revision: 2, submissionIds: [1, 2] }), saved({ month: "2026-12", revision: 2 })]) {
    let attempts = 0;
    const { handlers } = fixture({ store: { save: async () => { attempts++; throw new DigestOrderOperationError("DIGEST_ORDER_CONFLICT", latest); } } });
    const response = await handlers.PUT(request("PUT"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "DIGEST_ORDER_CONFLICT");
    assert.equal("latest" in body, latest.month === month);
    assert.equal(attempts, 1);
  }
});

test("DORDER-API-12 lease/validation/capability/schema 상태는 고정 public code로 전달한다", async () => {
  for (const [code, status] of [["DIGEST_ORDER_LEASE_REQUIRED", 423], ["INVALID_DIGEST_ORDER", 400],
    ["DIGEST_ORDER_UNAVAILABLE", 503], ["DIGEST_ORDER_SCHEMA_MISMATCH", 503]]) {
    const { handlers } = fixture({ store: { save: async () => { throw new DigestOrderOperationError(code); } } });
    const response = await handlers.PUT(request("PUT"));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
});

test("DORDER-API-13 일반 DB 예외/불완전 저장 응답은503이며 원문을 노출하지 않는다", async () => {
  let attempts = 0;
  const { handlers } = fixture({ store: { save: async () => { attempts++; throw new Error("PRIVATE_SQL_AND_HASH"); } } });
  const response = await handlers.PUT(request("PUT"));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("PRIVATE_SQL_AND_HASH"));
  assert.equal(attempts, 1);
  const malformed = fixture({ store: { save: async () => saved({ revision: 1, submissionIds: [1, 1] }) } });
  assert.equal((await malformed.handlers.PUT(request("PUT"))).status, 503);
});

test("DORDER-API-14 잘못된 method는405이며 auth/store를 호출하지 않는다", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.GET(new Request(`https://digest-order.fixture.invalid/api/digest-order?month=${month}`, { method: "DELETE" }));
  assert.equal(response.status, 405);
  assert.equal(calls.authorize, 0);
  assert.equal(calls.getStore, 0);
});

test("DORDER-API-15 thin route는 기존 서명세션/header fingerprint와 안전한 실행 port를 연결한다", async () => {
  const source = await readFile(new URL("../app/api/digest-order/route.ts", import.meta.url), "utf8");
  assert.match(source, /authorize: \(request\) => readWorkerSession\(request as NextRequest\)/);
  assert.match(source, /workspaceSessionFingerprint\(request\.headers\.get\("x-workspace-session-id"\)/);
  assert.match(source, /getStore: \(\) => createDigestOrderRepository\(getSupabaseAdmin\(\), retryFutureJwt\)/);
  assert.doesNotMatch(source, /console\.|\.json\(\)/);
  // 연결 소스 계약 검사이며 실제 서명 cookie/Next runtime 인증 검증은 아닙니다.
});

test("DORDER-API-16 증가할 수 없는 MAX_SAFE revision은 fingerprint/store 전에400", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.PUT(request("PUT", payload({ revision: Number.MAX_SAFE_INTEGER })));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_DIGEST_ORDER");
  assert.equal(calls.fingerprint, 0);
  assert.equal(calls.getStore, 0);
  assert.equal(calls.save, 0);
});

test("DORDER-API-17 저장 성공도 IDs 완전일치와 revision 정확+1 없으면503·재저장없음", async () => {
  const requested = payload({ revision: 2 });
  const invalid = [
    saved({ submissionIds: [1, 2], revision: 3 }),
    saved({ submissionIds: [2], revision: 3 }),
    saved({ submissionIds: [2, 1, 3], revision: 3 }),
    saved({ submissionIds: [], revision: 0, updatedAt: "" }),
    ...[1, 2, 4, Number.MAX_SAFE_INTEGER].map((revision) => saved({ revision })),
    saved({ month: "2026-12", revision: 3 }),
  ];
  for (const result of invalid) {
    let attempts = 0;
    const { handlers, calls } = fixture({ store: { save: async (value) => {
      attempts++; assert.deepEqual(value, requested); return result;
    } } });
    const response = await handlers.PUT(request("PUT", requested));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "DIGEST_ORDER_STORAGE_FAILED");
    assert.equal(attempts, 1);
    assert.equal(calls.read, 0);
  }
});

test("DORDER-API-18 비초기·마지막 안전 revision 및 빈 ID 저장도 정확+1이면 성공", async () => {
  for (const [revision, submissionIds] of [[3, [2, 1]], [Number.MAX_SAFE_INTEGER - 1, [2, 1]], [2, []]]) {
    const requested = payload({ revision, submissionIds });
    const result = saved({ revision: revision + 1, submissionIds });
    let attempts = 0;
    const { handlers } = fixture({ store: { save: async (value) => {
      attempts++; assert.deepEqual(value, requested); return result;
    } } });
    const response = await handlers.PUT(request("PUT", requested));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: true, order: result });
    assert.equal(attempts, 1);
  }
});
