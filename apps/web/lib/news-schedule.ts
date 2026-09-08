import type { NewsScheduleRange } from "@/lib/workspace-types";

type SchedulableNews = {
  dates: string[];
  scheduleText: string;
  scheduleRange: NewsScheduleRange | null;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function dateParts(value: string) {
  const match = DATE_PATTERN.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function shortDate(value: string, includeYear = false) {
  const parts = dateParts(value);
  if (!parts) return "";
  return `${includeYear ? `${parts.year}년 ` : ""}${parts.month}월 ${parts.day}일`;
}

export function validateScheduleRange(startDate: string, endDate: string) {
  if (!validDate(startDate)) return { valid: false as const, field: "startDate" as const, message: "시작일을 선택해 주세요." };
  if (!validDate(endDate)) return { valid: false as const, field: "endDate" as const, message: "종료일을 선택해 주세요." };
  if (endDate < startDate) return { valid: false as const, field: "endDate" as const, message: "종료일은 시작일과 같거나 이후여야 합니다." };
  return { valid: true as const, field: null, message: "" };
}

export function formatScheduleRange(range: NewsScheduleRange | null) {
  if (!range || !validDate(range.startDate) || !validDate(range.endDate)) return "";
  if (range.startDate === range.endDate) return shortDate(range.startDate);
  const start = dateParts(range.startDate);
  const end = dateParts(range.endDate);
  const crossesYear = start?.year !== end?.year;
  return `${shortDate(range.startDate, crossesYear)}~${shortDate(range.endDate, crossesYear)}`;
}

function monthEnd(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return "";
  const year = Number(match[1]);
  const numericMonth = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, numericMonth, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function rangeOverlapsMonth(range: NewsScheduleRange | null, month: string) {
  if (!range || !validDate(range.startDate) || !validDate(range.endDate) || range.endDate < range.startDate) return false;
  const end = monthEnd(month);
  return Boolean(end && range.startDate <= end && range.endDate >= `${month}-01`);
}

export function newsOccursOnDate(news: SchedulableNews, date: string) {
  if (!validDate(date)) return false;
  if (news.scheduleRange && date >= news.scheduleRange.startDate && date <= news.scheduleRange.endDate) return true;
  return news.dates.includes(date);
}

export function newsVisibleInMonth(news: SchedulableNews, submissionMonth: string, viewedMonth: string) {
  if (submissionMonth === viewedMonth) return true;
  if (news.dates.some((date) => date.startsWith(`${viewedMonth}-`))) return true;
  return rangeOverlapsMonth(news.scheduleRange, viewedMonth);
}

// 기존 개별 날짜는 scheduleText 우선 규칙을 유지하고, 새 기간에만 기간과 보충 문장을 함께 표시합니다.
export function formatNewsSchedule(news: SchedulableNews) {
  const rangeText = formatScheduleRange(news.scheduleRange);
  if (rangeText) return news.scheduleText.trim() ? `${rangeText}\n${news.scheduleText.trim()}` : rangeText;
  return news.scheduleText.trim() || news.dates.map((date) => shortDate(date)).filter(Boolean).join(", ");
}
