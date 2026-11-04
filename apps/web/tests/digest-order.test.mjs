import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DIGEST_ORDER_ITEMS,
  DigestOrderValidationError,
  classifyDigestOrderRecovery,
  isCurrentDigestResponse,
  isDigestOrderMonth,
  moveDigestOrder,
  parseDigestOrderCapability,
  parseDigestOrderRecord,
  parseDigestOrderRequest,
  projectDigestOrder,
} from "../lib/digest-order.ts";

const month = "2026-11";
const stamp = "2026-11-04T10:00:00.123456+00:00";
const request = (changes = {}) => ({ month, submissionIds: [3, 1], revision: 1, ...changes });
const record = (changes = {}) => ({ ...request(), updatedAt: stamp, ...changes });
const invalid = (callback) => assert.throws(callback, DigestOrderValidationError);

function frozen(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

test("DORDER-01 월은 고정7자 YYYY-MM이며 trailing newline/잘못된 월을 거부한다", () => {
  assert.equal(isDigestOrderMonth(month), true);
  for (const value of ["2026-00", "2026-13", "2026-1", "26-11", "2026-11\n", " 2026-11", 202611, null]) {
    assert.equal(isDigestOrderMonth(value), false);
    invalid(() => parseDigestOrderRequest(request({ month: value })));
  }
  invalid(() => parseDigestOrderRequest(request(), "2026-12"));
  invalid(() => parseDigestOrderRequest(request(), "broken"));
});

test("DORDER-02 ID는 최대500개의 유일한 양수 안전정수이며 원본 배열을 복사한다", () => {
  const source = frozen(request({ submissionIds: Array.from({ length: MAX_DIGEST_ORDER_ITEMS }, (_, index) => index + 1) }));
  const parsed = parseDigestOrderRequest(source);
  assert.deepEqual(parsed, source);
  assert.notEqual(parsed.submissionIds, source.submissionIds);
  for (const ids of [[1, 1], [0], [-1], [1.2], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], ["1"],
    null, {}, Array.from({ length: MAX_DIGEST_ORDER_ITEMS + 1 }, (_, index) => index + 1)]) {
    invalid(() => parseDigestOrderRequest(request({ submissionIds: ids })));
  }
  assert.deepEqual(parseDigestOrderRequest(request({ submissionIds: [Number.MAX_SAFE_INTEGER] })).submissionIds, [Number.MAX_SAFE_INTEGER]);
});

test("DORDER-03 revision은0이상의 안전정수이고 저장 요청 revision0은 ID를 가질 수 있다", () => {
  assert.equal(parseDigestOrderRequest(request({ revision: 0 })).revision, 0);
  assert.equal(parseDigestOrderRequest(request({ revision: Number.MAX_SAFE_INTEGER })).revision, Number.MAX_SAFE_INTEGER);
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    invalid(() => parseDigestOrderRequest(request({ revision })));
  }
});

test("DORDER-04 JSON 객체 이외/누락/추가 필드/접근자를 거부하고 getter를 실행하지 않는다", () => {
  for (const value of [null, [], "value", 1, new Date(), new (class { month = "2026-11"; })(),
    { month, revision: 1 }, { ...request(), extra: true }, { ...request(), [Symbol("hidden")]: true }]) {
    invalid(() => parseDigestOrderRequest(value));
  }
  let getterCalls = 0;
  const accessor = { ...request() };
  Object.defineProperty(accessor, "submissionIds", { get() { getterCalls += 1; return [1]; }, enumerable: true });
  invalid(() => parseDigestOrderRequest(accessor));
  assert.equal(getterCalls, 0);
  assert.deepEqual(parseDigestOrderRequest(Object.assign(Object.create(null), request())), request());
});

test("DORDER-05 sparse/추가속성/인덱스 접근자 배열을 거부한다", () => {
  const sparse = new Array(1);
  const extra = [1]; extra.metadata = "unexpected";
  let getterCalls = 0;
  const accessor = [1];
  Object.defineProperty(accessor, "0", { get() { getterCalls += 1; return 1; } });
  for (const submissionIds of [sparse, extra, accessor]) invalid(() => parseDigestOrderRequest(request({ submissionIds })));
  assert.equal(getterCalls, 0);
});

test("DORDER-06 초기 record sentinel과 저장 request를 구분한다", () => {
  const empty = { month, submissionIds: [], revision: 0, updatedAt: "" };
  assert.deepEqual(parseDigestOrderRecord(empty, month), empty);
  invalid(() => parseDigestOrderRecord(record({ revision: 0 })));
  invalid(() => parseDigestOrderRecord({ ...empty, updatedAt: stamp }));
  invalid(() => parseDigestOrderRecord({ ...empty, submissionIds: [1] }));
  invalid(() => parseDigestOrderRecord(record({ updatedAt: "" })));
});

test("DORDER-07 Postgres microseconds/UTC offset과 유효 ISO를 허용한다", () => {
  for (const updatedAt of [stamp, "2026-11-04T10:00:00Z", "2026-11-04T10:00:00.001Z",
    "2024-02-29T23:59:59+09:00", "2026-11-04T10:00:00.1-05:30"]) {
    assert.equal(parseDigestOrderRecord(record({ updatedAt })).updatedAt, updatedAt);
  }
});

test("DORDER-08 불가능 날짜/시각/zone/타입을 정규화해 성공시키지 않는다", () => {
  for (const updatedAt of ["2026-02-29T00:00:00Z", "2026-02-30T00:00:00Z", "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z", "2026-11-04T24:00:00Z", "2026-11-04T10:60:00Z",
    "2026-11-04T10:00:60Z", "2026-11-04T10:00:00+24:00", "2026-11-04T10:00:00+00:60",
    "2026-11-04T10:00:00", "2026-11-04T10:00:00Z\n", "2026-11-04", null, 123]) {
    invalid(() => parseDigestOrderRecord(record({ updatedAt })));
  }
  invalid(() => parseDigestOrderRecord(record(), "2026-12"));
});

test("DORDER-09 명시적 미설치 capability만 available:false이며 잘못된 응답을 미설치로 삼지 않는다", () => {
  assert.deepEqual(parseDigestOrderCapability({ available: false }, month), { available: false });
  assert.deepEqual(parseDigestOrderCapability({ available: true, order: record() }, month), { available: true, order: record() });
  for (const value of [null, {}, { available: "false" }, { available: true },
    { available: false, error: "timeout" }, { available: true, order: record({ month: "2026-12" }) }]) {
    invalid(() => parseDigestOrderCapability(value, month));
  }
  invalid(() => parseDigestOrderCapability({ available: false }, "broken"));
});

test("DORDER-10 현재월 완료만 저장순서에 투영하고 신규 완료는 ID순으로 덧붙인다", () => {
  const rows = frozen([
    { id: 8, month, status: "completed", title: "new8" },
    { id: 2, month, status: "draft", title: "draft" },
    { id: 1, month, status: "completed", title: "first" },
    { id: 3, month, status: "completed", title: "second" },
    { id: 6, month, status: "completed", title: "new6" },
    { id: 4, month: "2026-12", status: "completed", title: "other month" },
  ]);
  const savedIds = frozen([3, 2, 999, 1, 4]);
  const before = JSON.stringify({ rows, savedIds });
  const projected = projectDigestOrder(rows, month, savedIds);
  assert.deepEqual(projected.map((item) => item.id), [3, 1, 6, 8]);
  assert.equal(projected[0], rows[3]);
  assert.equal(JSON.stringify({ rows, savedIds }), before);
  assert.deepEqual(projectDigestOrder([...rows].reverse(), month, savedIds).map((item) => item.id), [3, 1, 6, 8]);
});

test("DORDER-11 draft/누락 ID를 저장목록에서 제거하지 않아 재완료 때 기존 위치로 돌아온다", () => {
  const savedIds = frozen([2, 1]);
  const rows = frozen([{ id: 1, month, status: "completed" }, { id: 2, month, status: "draft" }]);
  assert.deepEqual(projectDigestOrder(rows, month, savedIds).map((item) => item.id), [1]);
  assert.deepEqual(projectDigestOrder([{ ...rows[1], status: "completed" }, rows[0]], month, savedIds).map((item) => item.id), [2, 1]);
  assert.deepEqual(savedIds, [2, 1]);
});

test("DORDER-12 비어있는 투영은 원본을 쓰지 않으며 잘못된 ID/중복 record/상태는 거부한다", () => {
  assert.deepEqual(projectDigestOrder([], month, []), []);
  assert.deepEqual(projectDigestOrder([{ id: 1, month: "2026-12", status: "completed" }], month, []), []);
  for (const rows of [[{ id: 0, month, status: "completed" }], [{ id: 1, month, status: "bad" }],
    [{ id: 1, month, status: "completed" }, { id: 1, month, status: "draft" }]]) {
    invalid(() => projectDigestOrder(rows, month, []));
  }
  invalid(() => projectDigestOrder([], month, [1, 1]));
  invalid(() => projectDigestOrder([], "2026-13", []));
});

test("DORDER-13 드래그는 원본을 변경하지 않고 기존 대상 위치로 옮긴다", () => {
  const ids = frozen([1, 2, 3]);
  assert.deepEqual(moveDigestOrder(ids, 1, 3), [2, 3, 1]);
  assert.deepEqual(moveDigestOrder(ids, 3, 1), [3, 1, 2]);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("DORDER-14 없는 드래그/대상과 같은 ID는 복사된 no-op을 반환한다", () => {
  const ids = frozen([1, 2, 3]);
  for (const [from, to] of [[999, 1], [1, 999], [1, 1], [NaN, 1], [1, 0]]) {
    const moved = moveDigestOrder(ids, from, to);
    assert.deepEqual(moved, ids);
    assert.notEqual(moved, ids);
  }
  invalid(() => moveDigestOrder([1, 1], 1, 1));
});

test("DORDER-15 응답 유실은 같은월/동일IDs/증가한 revision 때만 확인된다", () => {
  const requested = frozen(request());
  assert.equal(classifyDigestOrderRecovery(requested, record({ revision: 2 })), "confirmed");
  assert.equal(classifyDigestOrderRecovery(requested, record({ revision: 8 })), "confirmed");
  assert.equal(classifyDigestOrderRecovery(request({ revision: 0 }), record({ revision: 1 })), "confirmed");
  assert.deepEqual(requested, request());
});

test("DORDER-16 새 revision의 다른 순서는 conflict이며 자동 덮어쓰기 결정을 하지 않는다", () => {
  for (const submissionIds of [[1, 3], [3], [], [3, 1, 9]]) {
    assert.equal(classifyDigestOrderRecovery(request(), record({ revision: 2, submissionIds })), "conflict");
  }
});

test("DORDER-17 미확인/다른월/같거나낮은 revision/잘못된 요청은 unknown이다", () => {
  for (const latest of [null, {}, record({ revision: 1 }), record({ revision: 0 }),
    record({ month: "2026-12", revision: 2 }), record({ revision: 2, submissionIds: [1, 1] }),
    record({ revision: 2, updatedAt: "broken" })]) {
    assert.equal(classifyDigestOrderRecovery(request(), latest), "unknown");
  }
  assert.equal(classifyDigestOrderRecovery({ ...request(), revision: -1 }, record({ revision: 2 })), "unknown");
});

test("DORDER-18 월을 떠났다가 돌아와도 이전 epoch 응답은 현재 상태에 적용하지 않는다", () => {
  assert.equal(isCurrentDigestResponse(month, month, 3, 3), true);
  assert.equal(isCurrentDigestResponse(month, "2026-12", 3, 3), false);
  assert.equal(isCurrentDigestResponse(month, month, 3, 5), false);
  assert.equal(isCurrentDigestResponse(month, month, NaN, 3), false);
  assert.equal(isCurrentDigestResponse(month, month, -1, -1), false);
  assert.equal(isCurrentDigestResponse("broken", "broken", 3, 3), false);
});
