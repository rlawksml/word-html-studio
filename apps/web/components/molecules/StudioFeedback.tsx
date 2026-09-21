import { useEffect, useRef } from "react";
import { LoadingBooks } from "@/components/atoms/LoadingBooks";
import type { StudioController } from "@/hooks/use-studio-controller";

export function StudioFeedback({ studio }: { studio: StudioController }) {
  const {
    accessRole, password, leaveTarget, editingEntryBlock, toast, pendingAction, setAccessRole, setPassword,
    setLeaveTarget, setEditingEntryBlock, login, confirmLeave, discardLeave,
  } = studio;
  const loginPending = pendingAction === "login-authenticating" || pendingAction === "login-workspace";
  const leavePending = pendingAction === "leave-save" || pendingAction === "leave-discard";
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const leaveContinueRef = useRef<HTMLButtonElement>(null);
  const previousLoginPendingRef = useRef(false);
  const previousLeavePendingRef = useRef(false);

  // 실패로 대화상자가 계속 열려 있으면 진행 안내가 사라진 뒤 재시도할 조작으로 포커스를 돌립니다.
  useEffect(() => {
    if (previousLoginPendingRef.current && !loginPending && accessRole) passwordInputRef.current?.focus();
    previousLoginPendingRef.current = loginPending;
  }, [accessRole, loginPending]);
  useEffect(() => {
    if (previousLeavePendingRef.current && !leavePending && leaveTarget) leaveContinueRef.current?.focus();
    previousLeavePendingRef.current = leavePending;
  }, [leavePending, leaveTarget]);
  const closeAccess = () => {
    if (loginPending) return;
    setAccessRole(null);
    setPassword("");
  };

  return <>
    {leaveTarget && <div className="modal-backdrop">
      <section className="leave-modal" role="dialog" aria-modal="true" aria-labelledby="leave-dialog-title" aria-busy={leavePending}>
        <span>WRITING IN PROGRESS</span>
        <h2 id="leave-dialog-title">작성 중인 내용이 있습니다.</h2>
        <p>안전하게 임시 저장한 뒤 이동하거나, <strong>마지막 자동 저장 이후 변경</strong>을 버리고 이동할 수 있습니다.</p>
        {leavePending && <p className="action-progress" role="status" aria-live="polite" tabIndex={-1} autoFocus>
          <LoadingBooks />
          {pendingAction === "leave-save" ? "작성한 내용을 안전하게 저장하고 있어요." : "저장하지 않은 변경을 버리고 이동하고 있어요."}
        </p>}
        <div className="leave-modal-actions">
          <button className="primary-button leave-save-button" onClick={confirmLeave} disabled={leavePending}>{pendingAction === "leave-save" ? "저장 후 이동 중..." : "임시 저장 후 이동"}</button>
          <button ref={leaveContinueRef} className="secondary-button leave-continue-button" onClick={() => setLeaveTarget(null)} disabled={leavePending} autoFocus>계속 작성</button>
          <button className="secondary-button leave-discard-button" onClick={() => void discardLeave()} disabled={leavePending}>{pendingAction === "leave-discard" ? "변경 정리 중..." : "저장하지 않고 이동"}</button>
        </div>
      </section>
    </div>}
    {editingEntryBlock && <div className="modal-backdrop" onMouseDown={() => setEditingEntryBlock(null)}>
      <section className="editing-blocked-modal" role="alertdialog" aria-modal="true" aria-labelledby="editing-blocked-title" onMouseDown={(event) => event.stopPropagation()}>
        <span>EDITING LOCKED</span>
        <h2 id="editing-blocked-title">{editingEntryBlock.bookstoreName}에 지금 들어갈 수 없습니다.</h2>
        {editingEntryBlock.reason === "occupied"
          ? <p>다른 {editingEntryBlock.activeRole === "html" ? "HTML 편집자" : "소식 입력자"}가 이 책방을 편집 중입니다. 작업이 끝날 때까지 목록에서 기다려 주세요. 활동이 없으면 약 3분 뒤 자동으로 편집할 수 있습니다.</p>
          : <p>다른 사용자의 편집 상태를 확인하지 못해 안전하게 진입을 멈췄습니다. 네트워크를 확인한 뒤 잠시 후 다시 시도해 주세요.</p>}
        <div className="editing-blocked-actions"><button className="primary-button" onClick={() => setEditingEntryBlock(null)} autoFocus>확인</button></div>
      </section>
    </div>}
    {accessRole && <div className="modal-backdrop" onMouseDown={closeAccess}>
      <section className="access-modal" role="dialog" aria-modal="true" aria-labelledby="access-dialog-title" aria-busy={loginPending} onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={closeAccess} disabled={loginPending} aria-label="접속 창 닫기">×</button>
        <span>{accessRole === "input" ? "NEWS INPUT ACCESS" : "HTML EDITOR ACCESS"}</span>
        <h2 id="access-dialog-title">{accessRole === "input" ? "소식 입력" : "HTML 편집"} 접속</h2>
        <p>{accessRole === "input" ? "책방 소식을 작성하려면 입력자 암호를 입력해 주세요." : "완료된 소식을 HTML로 편집하려면 편집자 암호를 입력해 주세요."}</p>
        <label>
          <span>작업 암호</span>
          <input ref={passwordInputRef} type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void login()} disabled={loginPending} autoFocus />
        </label>
        {loginPending && <div className="access-progress" role="status" aria-live="polite" tabIndex={-1} autoFocus>
          <LoadingBooks />
          <div>
            <strong>{pendingAction === "login-authenticating" ? "작업 암호를 확인하고 있어요." : "동네책방 작업 공간을 준비하고 있어요."}</strong>
            <small>확인이 끝나면 자동으로 이동합니다.</small>
          </div>
        </div>}
        <button className="primary-button" onClick={() => void login()} disabled={loginPending || !password.trim()}>{loginPending ? "접속 확인 중..." : accessRole === "input" ? "소식 입력으로 이동" : "HTML 편집으로 이동"}</button>
        <small>한글·영문 자판 어느 쪽으로 입력해도 됩니다. 접속 상태는 이 탭을 닫거나 로그아웃할 때까지 유지됩니다.</small>
      </section>
    </div>}
    {toast && <div className="toast">✓ {toast}</div>}
  </>;
}
