import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatNewsSchedule,
  formatScheduleRange,
  newsOccursOnDate,
  newsVisibleInMonth,
  rangeOverlapsMonth,
  validateScheduleRange,
} from "../lib/news-schedule.ts";

const periodNews = {
  dates: [],
  scheduleText: "",
  scheduleRange: { startDate: "2026-06-17", endDate: "2026-08-12" },
};

test("기간 일정은 월·연도 경계와 하루짜리 범위를 정확히 표시한다", () => {
  assert.equal(formatScheduleRange(periodNews.scheduleRange), "6월 17일~8월 12일");
  assert.equal(formatScheduleRange({ startDate: "2026-07-03", endDate: "2026-07-03" }), "7월 3일");
  assert.equal(formatScheduleRange({ startDate: "2026-12-31", endDate: "2027-01-02" }), "2026년 12월 31일~2027년 1월 2일");
});

test("6월부터 8월까지의 기간은 세 달에만 노출되고 모든 포함 날짜에 표시된다", () => {
  assert.equal(rangeOverlapsMonth(periodNews.scheduleRange, "2026-05"), false);
  assert.equal(rangeOverlapsMonth(periodNews.scheduleRange, "2026-06"), true);
  assert.equal(rangeOverlapsMonth(periodNews.scheduleRange, "2026-07"), true);
  assert.equal(rangeOverlapsMonth(periodNews.scheduleRange, "2026-08"), true);
  assert.equal(rangeOverlapsMonth(periodNews.scheduleRange, "2026-09"), false);
  assert.equal(newsOccursOnDate(periodNews, "2026-06-16"), false);
  assert.equal(newsOccursOnDate(periodNews, "2026-06-17"), true);
  assert.equal(newsOccursOnDate(periodNews, "2026-07-20"), true);
  assert.equal(newsOccursOnDate(periodNews, "2026-08-12"), true);
  assert.equal(newsOccursOnDate(periodNews, "2026-08-13"), false);
});

test("기존 개별 날짜와 일정 문장 표시 규칙은 바꾸지 않는다", () => {
  const dated = { dates: ["2026-07-03", "2026-07-17"], scheduleText: "", scheduleRange: null };
  const described = { ...dated, scheduleText: "매월 첫째 목요일 오후 7시" };
  assert.equal(formatNewsSchedule(dated), "7월 3일, 7월 17일");
  assert.equal(formatNewsSchedule(described), "매월 첫째 목요일 오후 7시");
  assert.equal(newsOccursOnDate(dated, "2026-07-17"), true);
  assert.equal(newsVisibleInMonth(dated, "2026-07", "2026-07"), true);
});

test("기간과 다른 달에 입력한 개별 날짜도 해당 방문자 달력에서 찾을 수 있다", () => {
  assert.equal(newsVisibleInMonth(periodNews, "2026-06", "2026-07"), true);
  assert.equal(newsVisibleInMonth(periodNews, "2026-06", "2026-09"), false);
  assert.equal(newsVisibleInMonth({ dates: ["2026-08-02"], scheduleText: "", scheduleRange: null }, "2026-07", "2026-08"), true);
});

test("종료일이 시작일보다 빠르거나 한쪽 날짜가 없으면 기간을 적용할 수 없다", () => {
  assert.deepEqual(validateScheduleRange("", "2026-08-12"), { valid: false, field: "startDate", message: "시작일을 선택해 주세요." });
  assert.deepEqual(validateScheduleRange("2026-06-17", ""), { valid: false, field: "endDate", message: "종료일을 선택해 주세요." });
  assert.deepEqual(validateScheduleRange("2026-08-12", "2026-06-17"), { valid: false, field: "endDate", message: "종료일은 시작일과 같거나 이후여야 합니다." });
  assert.deepEqual(validateScheduleRange("2026-06-17", "2026-08-12"), { valid: true, field: null, message: "" });
});

test("입력 UI는 날짜와 기간을 구분하고 명시적인 기간 적용 동작을 제공한다", async () => {
  const source = await readFile(new URL("../components/molecules/NewsScheduleField.tsx", import.meta.url), "utf8");
  assert.match(source, /날짜 \(하루·여러 날\)/);
  assert.match(source, /기간 입력/);
  assert.match(source, />기간 적용<\/button>/);
  assert.match(source, /min=\{pendingStartDate\}/);
  assert.match(source, /data-schedule-range-field="endDate"/);
  assert.match(source, /data-schedule-range-news-id=\{newsId\}/);
});

test("기간은 저장 API·방문자 상세·HTML 생성기에서 같은 규칙으로 연결된다", async () => {
  const [submissionRoute, workspaceRoute, records, validation, controller, detail, html] = await Promise.all([
    readFile(new URL("../app/api/submissions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workspace-records.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workspace-validation.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/use-studio-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/molecules/PublicNewsDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/html-generators.ts", import.meta.url), "utf8"),
  ]);
  assert.match(submissionRoute, /save_submission_with_schedule_ranges/);
  assert.match(submissionRoute, /p_sync_ranges: role === "input"/);
  assert.match(workspaceRoute, /news_schedule_ranges/);
  assert.match(records, /delete jsonItem\.scheduleRange/);
  assert.match(records, /rangesByNewsId/);
  assert.match(validation, /INVALID_SCHEDULE_RANGE/);
  assert.match(controller, /newsVisibleInMonth\(news, submission\.month, month\)/);
  assert.match(controller, /newsOccursOnDate/);
  assert.match(detail, /formatNewsSchedule\(news\)/);
  assert.match(html, /formatNewsSchedule\(news\)/);
});
