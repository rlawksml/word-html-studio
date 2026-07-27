import type { Submission } from "@/lib/workspace-types";

/**
 * 저장 큐 앞쪽의 자동 저장이 updatedAt을 바꿨어도 사용자가 보고 있던 마지막 본문은 유지합니다.
 * 다른 탭의 버전은 클라이언트에 없으므로 서버의 기존 충돌 검사가 그대로 막습니다.
 */
export function rebaseSubmissionSnapshot(snapshot: Submission, current?: Submission) {
  return current?.id === snapshot.id ? { ...snapshot, updatedAt: current.updatedAt } : snapshot;
}
