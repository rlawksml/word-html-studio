import {
  IMPROVEMENT_REQUEST_TYPE_LABELS,
  type ImprovementRequestType,
} from "@/lib/improvement-types";

export function ImprovementTypeChip({ requestType }: { requestType: ImprovementRequestType }) {
  return <span className={`improvement-type type-${requestType}`}>
    {IMPROVEMENT_REQUEST_TYPE_LABELS[requestType]}
  </span>;
}
