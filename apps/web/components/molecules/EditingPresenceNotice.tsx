import type { EditingPresence } from "@/lib/workspace-types";

export function EditingPresenceNotice({ presence }: { presence: EditingPresence }) {
  if (presence.status !== "occupied" && presence.status !== "unavailable") return null;
  if (presence.status === "unavailable") return <aside className="editing-presence-notice presence-unavailable" role="status">
    <strong>동시 작업 상태를 확인하지 못했습니다.</strong>
    <p>작성은 계속할 수 있으며, 저장할 때 기존 충돌 방지가 변경 내용을 보호합니다.</p>
  </aside>;
  const worker = presence.activeRole === "html" ? "HTML 편집자" : "소식 입력자";
  return <aside className="editing-presence-notice presence-occupied" role="status" aria-live="polite">
    <span>동시 작업 안내</span>
    <strong>다른 {worker}가 이 내용을 편집 중입니다.</strong>
    <p>내용을 확인할 수는 있지만 동시에 수정하면 저장 충돌이 발생할 수 있습니다. 가능하면 잠시 후 이어서 작성해 주세요.</p>
  </aside>;
}
