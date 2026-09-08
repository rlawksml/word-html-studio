import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addNewsDate,
  formatNewsDate,
  removeNewsDate,
} from "../lib/news-date-selection.ts";

test("달력에서 고른 날짜는 명시적으로 추가할 때만 목록에 반영한다", () => {
  const savedDates = ["2026-07-03"];

  // 브라우저 달력의 월 이동이나 임시 선택은 이 함수를 호출하기 전이므로 저장값을 바꾸지 않습니다.
  assert.deepEqual(savedDates, ["2026-07-03"]);
  assert.deepEqual(addNewsDate(savedDates, "2026-08-12"), ["2026-07-03", "2026-08-12"]);
  assert.deepEqual(savedDates, ["2026-07-03"], "기존 배열을 직접 변경하면 안 됩니다.");
});

test("같은 날짜는 중복 추가하지 않고 한 날짜 삭제가 다른 날짜에 영향을 주지 않는다", () => {
  const dates = ["2026-07-03", "2026-08-12"];
  assert.deepEqual(addNewsDate(dates, "2026-07-03"), dates);
  assert.deepEqual(removeNewsDate(dates, "2026-08-12"), ["2026-07-03"]);
});

test("발행 연도와 다른 날짜는 연도를 함께 표시한다", () => {
  assert.equal(formatNewsDate("2026-07-03", "2026-07"), "7월 3일");
  assert.equal(formatNewsDate("2027-01-02", "2026-07"), "2027년 1월 2일");
});

test("날짜 입력 UI는 선택과 목록 추가를 별도 동작으로 유지한다", async () => {
  const source = await readFile(new URL("../components/molecules/NewsDateField.tsx", import.meta.url), "utf8");

  assert.match(source, /type="date"/);
  assert.match(source, /setPendingDate\(event\.target\.value\)/);
  assert.match(source, /type="button"/);
  assert.match(source, />날짜 추가<\/button>/);
  assert.doesNotMatch(source, /onChange=\{\(event\) => onDatesChange/);
});
