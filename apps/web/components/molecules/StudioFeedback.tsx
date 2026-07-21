import type { StudioController } from "@/hooks/use-studio-controller";

export function StudioFeedback({ studio }: { studio: StudioController }) {
  const { accessRole, password, leaveTarget, toast, setAccessRole, setPassword, setLeaveTarget, login, confirmLeave } = studio;
  return <>
    {leaveTarget && <div className="modal-backdrop"><section className="leave-modal" role="dialog" aria-modal="true" aria-labelledby="leave-dialog-title"><span>WRITING IN PROGRESS</span><h2 id="leave-dialog-title">작성 중인 내용이 있습니다.</h2><p>입력 마무리 전인 소식입니다. 지금 나가도 내용은 임시 저장되지만 상태는 <strong>작성 중</strong>으로 유지됩니다.</p><div className="leave-modal-actions"><button className="secondary-button" onClick={() => setLeaveTarget(null)} autoFocus>계속 작성</button><button className="primary-button" onClick={confirmLeave}>임시 저장 후 나가기</button></div></section></div>}
    {accessRole && <div className="modal-backdrop" onMouseDown={() => { setAccessRole(null); setPassword(""); }}><section className="access-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => { setAccessRole(null); setPassword(""); }}>×</button><span>{accessRole === "input" ? "NEWS INPUT ACCESS" : "HTML EDITOR ACCESS"}</span><h2>{accessRole === "input" ? "소식 입력" : "HTML 편집"} 접속</h2><p>{accessRole === "input" ? "책방 소식을 작성하려면 입력자 암호를 입력해 주세요." : "완료된 소식을 HTML로 편집하려면 편집자 암호를 입력해 주세요."}</p><label><span>작업 암호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && login()} autoFocus /></label><button className="primary-button" onClick={login}>{accessRole === "input" ? "소식 입력으로 이동" : "HTML 편집으로 이동"}</button><small>한글·영문 자판 어느 쪽으로 입력해도 됩니다. 접속 상태는 이 탭을 닫거나 로그아웃할 때까지 유지됩니다.</small></section></div>}
    {toast && <div className="toast">✓ {toast}</div>}
  </>;
}
