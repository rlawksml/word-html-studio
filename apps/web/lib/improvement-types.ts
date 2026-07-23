export const IMPROVEMENT_STATUSES = ["received", "checking", "in_progress", "resolved"] as const;

export type ImprovementStatus = typeof IMPROVEMENT_STATUSES[number];

export type ImprovementRequest = {
  id: string;
  title: string;
  content: string;
  status: ImprovementStatus;
  targetDate: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
};

export const IMPROVEMENT_STATUS_LABELS: Record<ImprovementStatus, string> = {
  received: "접수됨",
  checking: "확인 중",
  in_progress: "진행 중",
  resolved: "해결됨",
};

export function isImprovementStatus(value: unknown): value is ImprovementStatus {
  return typeof value === "string" && IMPROVEMENT_STATUSES.includes(value as ImprovementStatus);
}
