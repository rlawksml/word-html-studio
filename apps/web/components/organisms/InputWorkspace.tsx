import { WorkStatusBadge } from "@/components/atoms/WorkStatusBadge";
import { BookstoreManagement } from "@/components/organisms/BookstoreManagement";
import { NewsEditorWorkspace } from "@/components/organisms/NewsEditorWorkspace";
import type { StudioController } from "@/hooks/use-studio-controller";
import { formatMonth, formatSavedAt, shiftMonth } from "@/lib/workspace-formatters";

// 입력자의 목록·책방 관리·소식 편집 화면을 전환하는 상위 organism입니다.
export function InputWorkspace({ studio }: { studio: StudioController }) {
  const {
    bookstores, submissions, month, inputView, monthSubmissions, completedBookstoreCount,
    completionPercent, setBookstores, setMonth, setInputView, openBookstore,
    completionShareMessage, copyText, notify,
  } = studio;
  return <section className="input-area">
    <div className="input-flow-guide" aria-label="소식 입력 순서">
      <strong>① 발행 월 확인</strong><span aria-hidden="true">→</span><strong>② 소식 작성</strong><span aria-hidden="true">→</span><strong>③ 입력 마무리</strong>
    </div>

    {inputView === "list" && <>
      <div className="workspace-heading"><div><span>BOOKSTORE NEWS INPUT</span><h1>책방 소식 입력</h1><p>책방을 선택해 한 곳씩 작성하세요. 입력 내용은 자동으로 저장됩니다.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void copyText(completionShareMessage())} disabled={!monthSubmissions.some((item) => item.status === "completed")}>완료 내용 공유하기</button><button className="primary-button" onClick={() => setInputView("bookstores")}>책방 관리</button></div></div>
      <div className="input-month-summary">
        <div className="input-month-nav" aria-label="발행 월 선택">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))}>← 이전 달</button>
          <div><span>발행 월</span><strong aria-live="polite">{formatMonth(month)}</strong></div>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))}>다음 달 →</button>
        </div>
        <div className="work-progress-summary">
          <div><span>이번 달 작업 진행률</span><strong>{completedBookstoreCount}/{bookstores.length}곳 완료</strong></div>
          <div className="work-progress-track" role="progressbar" aria-label="이번 달 책방 입력 완료율" aria-valuemin={0} aria-valuemax={bookstores.length} aria-valuenow={completedBookstoreCount}><i style={{ width: `${completionPercent}%` }} /></div>
        </div>
      </div>
      {bookstores.length ? <div className="bookstore-work-list">{bookstores.map((bookstore) => {
        const submission = submissions.find((item) => item.bookstoreId === bookstore.id && item.month === month);
        const images = submission?.news.reduce((sum, news) => sum + news.images.length, 0) || 0;
        return <button key={bookstore.id} onClick={() => openBookstore(bookstore.id)}><div><span>{bookstore.region}</span><h2>{bookstore.name}</h2><p>{submission ? `소식 ${submission.news.length}건 · 사진 ${images}장` : "이번 달 소식 없음"}</p></div><div><WorkStatusBadge submission={submission} /><small>{submission ? formatSavedAt(submission.updatedAt) : "작성 시작하기"}</small></div></button>;
      })}</div> : <div className="empty-state input-empty-state"><h2>등록된 책방이 없습니다.</h2><p>책방 관리에서 첫 책방의 기본정보를 등록해 주세요.</p><button className="primary-button" onClick={() => setInputView("bookstores")}>책방 등록하기</button></div>}
    </>}

    {/* inputView는 별도 URL이 아니라 한 작업 흐름 안의 세 화면 상태를 뜻합니다. */}
    {inputView === "bookstores" && <BookstoreManagement bookstores={bookstores} setBookstores={setBookstores} onBack={() => setInputView("list")} notify={notify} />}
    {inputView === "edit" && <NewsEditorWorkspace studio={studio} />}
  </section>;
}
