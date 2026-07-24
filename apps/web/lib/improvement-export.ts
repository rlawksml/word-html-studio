import {
  IMPROVEMENT_REQUEST_TYPE_LABELS,
  IMPROVEMENT_STATUS_LABELS,
  type ImprovementRequest,
} from "@/lib/improvement-types";

const dateLabel = (value: string) => value
  ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(new Date(value))
  : "";

export function improvementsMarkdown(items: ImprovementRequest[]) {
  const sections = items.map((item) => {
    const facts = [
      `- 유형: ${IMPROVEMENT_REQUEST_TYPE_LABELS[item.requestType]}`,
      `- 상태: ${IMPROVEMENT_STATUS_LABELS[item.status]}`,
      `- 접수일: ${dateLabel(item.createdAt)}`,
      item.targetDate ? `- 예정일: ${dateLabel(`${item.targetDate}T00:00:00+09:00`)}` : "",
      item.resolvedAt ? `- 해결일: ${dateLabel(item.resolvedAt)}` : "",
      item.requestType === "bug" && item.location ? `- 발생 위치/사용 경로: ${item.location}` : "",
      item.requestType === "improvement" && item.reason ? `- 필요한 이유: ${item.reason}` : "",
    ].filter(Boolean).join("\n");
    return `## [${IMPROVEMENT_REQUEST_TYPE_LABELS[item.requestType]} · ${IMPROVEMENT_STATUS_LABELS[item.status]}] ${item.title}\n\n${facts}\n\n${item.content.trim()}`;
  });

  return `# 동네책방 소식 스튜디오 버그·개선사항\n\n생성일: ${dateLabel(new Date().toISOString())}\n총 ${items.length}건\n\n${sections.join("\n\n---\n\n")}\n`;
}

export function improvementsJson(items: ImprovementRequest[]) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    count: items.length,
    improvements: items,
  }, null, 2);
}
