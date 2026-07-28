import type { Submission } from "@/lib/workspace-types";

/**
 * 저장 큐 앞쪽의 자동 저장이 updatedAt을 바꿨어도 사용자가 보고 있던 마지막 본문은 유지합니다.
 * 다른 탭의 버전은 클라이언트에 없으므로 서버의 기존 충돌 검사가 그대로 막습니다.
 */
export function rebaseSubmissionSnapshot(snapshot: Submission, current?: Submission) {
  return current?.id === snapshot.id ? { ...snapshot, updatedAt: current.updatedAt } : snapshot;
}

/**
 * 사용자가 "저장하지 않고 이동"을 선택하면 마지막으로 서버가 확인한 스냅샷으로 되돌립니다.
 * 아직 한 번도 저장되지 않은 새 소식은 목록에서 제거해 화면의 임시 입력이 다시 자동 저장되지 않게 합니다.
 */
export function restoreSubmissionFromBaseline(
  submissions: Submission[],
  submissionId: number,
  baseline?: Submission,
) {
  if (!submissions.some((submission) => submission.id === submissionId)) return submissions;
  if (!baseline) return submissions.filter((submission) => submission.id !== submissionId);
  return submissions.map((submission) => submission.id === submissionId ? baseline : submission);
}
