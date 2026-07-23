import { IMPROVEMENT_STATUS_LABELS, type ImprovementStatus } from "@/lib/improvement-types";

export function ImprovementStatusChip({ status }: { status: ImprovementStatus }) {
  return <span className={`improvement-status status-${status}`}>{IMPROVEMENT_STATUS_LABELS[status]}</span>;
}
