import { IMPROVEMENT_STATUS_LABELS, type ImprovementRequest } from "@/lib/improvement-types";

const dateLabel = (value: string) => value
  ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(new Date(value))
  : "";

export function improvementsMarkdown(items: ImprovementRequest[]) {
  const sections = items.map((item) => {
    const facts = [
      `- 상태: ${IMPROVEMENT_STATUS_LABELS[item.status]}`,
      `- 접수일: ${dateLabel(item.createdAt)}`,
      item.targetDate ? `- 예정일: ${dateLabel(`${item.targetDate}T00:00:00+09:00`)}` : "",
      item.resolvedAt ? `- 해결일: ${dateLabel(item.resolvedAt)}` : "",
    ].filter(Boolean).join("\n");
    return `## [${IMPROVEMENT_STATUS_LABELS[item.status]}] ${item.title}\n\n${facts}\n\n${item.content.trim()}`;
  });

  return `# 동네책방 소식 스튜디오 개선사항\n\n생성일: ${dateLabel(new Date().toISOString())}\n총 ${items.length}건\n\n${sections.join("\n\n---\n\n")}\n`;
}

export function improvementsJson(items: ImprovementRequest[]) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    count: items.length,
    improvements: items,
  }, null, 2);
}
