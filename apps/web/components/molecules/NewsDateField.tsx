"use client";

import { useState } from "react";
import { addNewsDate, formatNewsDate, removeNewsDate } from "@/lib/news-date-selection";

type NewsDateFieldProps = {
  newsId: number;
  dates: string[];
  publicationMonth: string;
  onDatesChange: (dates: string[]) => void;
};

// 브라우저 달력의 월 탐색은 임시 값만 바꾸고, 명시적인 버튼을 눌러야 실제 소식 날짜에 반영합니다.
export function NewsDateField({ newsId, dates, publicationMonth, onDatesChange }: NewsDateFieldProps) {
  const [pendingDate, setPendingDate] = useState("");
  const inputId = `news-${newsId}-pending-date`;
  const duplicate = Boolean(pendingDate && dates.includes(pendingDate));

  const confirmDate = () => {
    if (!pendingDate || duplicate) return;
    onDatesChange(addNewsDate(dates, pendingDate));
    setPendingDate("");
  };

  return <fieldset className="wide news-date-field">
    <legend>행사 날짜 <em>달력에 표시할 날짜 · 여러 개 가능</em></legend>
    {dates.length > 0 && <div className="date-list" aria-label="추가된 행사 날짜">
      {dates.map((date) => <span key={date}>{formatNewsDate(date, publicationMonth)}<button
        type="button"
        onClick={() => onDatesChange(removeNewsDate(dates, date))}
        aria-label={`${formatNewsDate(date, publicationMonth)} 삭제`}
      >×</button></span>)}
    </div>}
    <div className="date-picker-row">
      <label className="sr-only" htmlFor={inputId}>추가할 행사 날짜</label>
      <input id={inputId} type="date" value={pendingDate} onChange={(event) => setPendingDate(event.target.value)} />
      <button type="button" onClick={confirmDate} disabled={!pendingDate || duplicate}>날짜 추가</button>
    </div>
    <small>{duplicate ? "이미 추가된 날짜입니다." : "날짜를 고른 뒤 ‘날짜 추가’를 눌러주세요. 달력의 월 이동만으로는 추가되지 않습니다."}</small>
  </fieldset>;
}
