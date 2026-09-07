"use client";

import { useState } from "react";
import { NewsDateField } from "@/components/molecules/NewsDateField";
import { formatScheduleRange, validateScheduleRange } from "@/lib/news-schedule";
import type { NewsScheduleRange } from "@/lib/workspace-types";

type NewsScheduleFieldProps = {
  newsId: number;
  dates: string[];
  scheduleRange: NewsScheduleRange | null;
  publicationMonth: string;
  onDatesChange: (dates: string[]) => void;
  onRangeChange: (range: NewsScheduleRange | null) => void;
};

// 불완전한 시작일·종료일은 로컬 임시값으로 두고, 유효한 기간만 Submission 자동 저장에 포함합니다.
export function NewsScheduleField({ newsId, dates, scheduleRange, publicationMonth, onDatesChange, onRangeChange }: NewsScheduleFieldProps) {
  const [mode, setMode] = useState<"dates" | "range">(scheduleRange ? "range" : "dates");
  const [pendingStartDate, setPendingStartDate] = useState(scheduleRange?.startDate || "");
  const [pendingEndDate, setPendingEndDate] = useState(scheduleRange?.endDate || "");
  const [error, setError] = useState("");

  const applyRange = () => {
    const result = validateScheduleRange(pendingStartDate, pendingEndDate);
    if (!result.valid) {
      setError(result.message);
      document.querySelector<HTMLInputElement>(`[data-schedule-range-news-id="${newsId}"][data-schedule-range-field="${result.field}"]`)?.focus();
      return;
    }
    setError("");
    onDatesChange([]);
    onRangeChange({ startDate: pendingStartDate, endDate: pendingEndDate });
  };

  const updateDates = (nextDates: string[]) => {
    if (nextDates.length > 0) onRangeChange(null);
    onDatesChange(nextDates);
  };

  return <fieldset className="wide news-schedule-field">
    <legend>행사 일정 <em>선택</em></legend>
    <div className="schedule-mode-tabs" role="group" aria-label="일정 입력 방식">
      <button type="button" className={mode === "dates" ? "active" : ""} aria-pressed={mode === "dates"} onClick={() => setMode("dates")}>날짜 (하루·여러 날)</button>
      <button type="button" className={mode === "range" ? "active" : ""} aria-pressed={mode === "range"} onClick={() => setMode("range")}>기간 입력</button>
    </div>
    {mode === "dates" ? <NewsDateField newsId={newsId} dates={dates} publicationMonth={publicationMonth} onDatesChange={updateDates} /> : <div className="schedule-range-panel">
      {scheduleRange && <div className="applied-range"><span>적용된 기간</span><strong>{formatScheduleRange(scheduleRange)}</strong><button type="button" onClick={() => { onRangeChange(null); setPendingStartDate(""); setPendingEndDate(""); }}>기간 지우기</button></div>}
      <div className="schedule-range-inputs">
        <label><span>시작일</span><input type="date" value={pendingStartDate} data-schedule-range-news-id={newsId} data-schedule-range-field="startDate" onChange={(event) => { setPendingStartDate(event.target.value); setError(""); }} /></label>
        <span aria-hidden="true">~</span>
        <label><span>종료일</span><input type="date" value={pendingEndDate} min={pendingStartDate} data-schedule-range-news-id={newsId} data-schedule-range-field="endDate" onChange={(event) => { setPendingEndDate(event.target.value); setError(""); }} /></label>
        <button type="button" onClick={applyRange}>기간 적용</button>
      </div>
      <small>시작일과 종료일만 선택하면 사이의 모든 날짜가 방문자 달력에 표시됩니다.</small>
      {error && <p className="schedule-range-error" role="alert">{error}</p>}
    </div>}
  </fieldset>;
}
