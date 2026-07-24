export const IMPROVEMENT_STATUSES = ["received", "checking", "in_progress", "resolved"] as const;
export const IMPROVEMENT_REQUEST_TYPES = ["bug", "improvement"] as const;

export type ImprovementStatus = typeof IMPROVEMENT_STATUSES[number];
export type ImprovementRequestType = typeof IMPROVEMENT_REQUEST_TYPES[number];

export type ImprovementRequest = {
  id: string;
  requestType: ImprovementRequestType;
  title: string;
  content: string;
  location: string;
  reason: string;
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

export const IMPROVEMENT_REQUEST_TYPE_LABELS: Record<ImprovementRequestType, string> = {
  bug: "버그",
  improvement: "개선",
};

export function isImprovementStatus(value: unknown): value is ImprovementStatus {
  return typeof value === "string" && IMPROVEMENT_STATUSES.includes(value as ImprovementStatus);
}

export function isImprovementRequestType(value: unknown): value is ImprovementRequestType {
  return typeof value === "string" && IMPROVEMENT_REQUEST_TYPES.includes(value as ImprovementRequestType);
}
