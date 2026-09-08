const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

// 날짜 선택기의 임시 값과 실제 Submission의 dates[]를 분리하기 위한 순수 함수입니다.
export function addNewsDate(dates: readonly string[], candidate: string) {
  if (!datePattern.test(candidate) || dates.includes(candidate)) return [...dates];
  return [...dates, candidate].sort();
}

export function removeNewsDate(dates: readonly string[], target: string) {
  return dates.filter((date) => date !== target);
}

export function formatNewsDate(value: string, publicationMonth: string) {
  const match = datePattern.exec(value);
  if (!match) return "";
  const formatted = `${Number(match[2])}월 ${Number(match[3])}일`;
  return match[1] === publicationMonth.slice(0, 4) ? formatted : `${Number(match[1])}년 ${formatted}`;
}
