import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRowsAbsent,
  assertStorageObjectAbsent,
  runExactCleanup,
} from "./helpers/supabase-cleanup-guard.mjs";

test("cleanup attempts every exact target and reports all failures", async () => {
  const attempted = [];

  await assert.rejects(
    runExactCleanup([
      { label: "첫 번째", run: async () => { attempted.push("first"); return { error: { message: "삭제 거부" } }; } },
      { label: "두 번째", run: async () => { attempted.push("second"); throw new Error("네트워크 오류"); } },
      { label: "세 번째", run: async () => { attempted.push("third"); return { error: null }; } },
    ]),
    (error) => {
      assert.match(error.message, /첫 번째: 삭제 거부/);
      assert.match(error.message, /두 번째: 네트워크 오류/);
      return true;
    },
  );

  assert.deepEqual(attempted, ["first", "second", "third"]);
});

test("row absence guard rejects a remaining QA row", async () => {
  await assert.doesNotReject(assertRowsAbsent(Promise.resolve({ data: [], error: null }), "소식"));
  await assert.rejects(
    assertRowsAbsent(Promise.resolve({ data: [{ id: 1 }], error: null }), "소식"),
    /소식: 정리 후 1건이 남았습니다/,
  );
  await assert.rejects(
    assertRowsAbsent(Promise.resolve({ data: null, error: { message: "조회 실패" } }), "소식"),
    /소식: 조회 실패/,
  );
});

test("storage absence guard checks only the exact object name", async () => {
  const calls = [];
  const emptyBucket = {
    list: async (folder, options) => {
      calls.push({ folder, options });
      return { data: [{ name: "another.jpg" }], error: null };
    },
  };
  await assert.doesNotReject(assertStorageObjectAbsent(emptyBucket, "originals/2099-12/1/2/target.jpg", "원본"));
  assert.deepEqual(calls, [{ folder: "originals/2099-12/1/2", options: { limit: 100, search: "target.jpg" } }]);

  const remainingBucket = {
    list: async () => ({ data: [{ name: "target.jpg" }], error: null }),
  };
  await assert.rejects(
    assertStorageObjectAbsent(remainingBucket, "originals/2099-12/1/2/target.jpg", "원본"),
    /원본: 정리 후 target\.jpg 객체가 남았습니다/,
  );
});
