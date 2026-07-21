import { submissionStatus } from "@/lib/workspace-formatters";
import type { Submission } from "@/lib/workspace-types";

export function WorkStatusBadge({ submission }: { submission?: Submission }) {
  const status = submissionStatus(submission);
  return <span className={`work-status status-${status.replaceAll(" ", "-")}`}>{status}</span>;
}
