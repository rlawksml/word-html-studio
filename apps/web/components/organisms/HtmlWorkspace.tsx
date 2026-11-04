import { PublishPanel } from "@/components/molecules/PublishPanel";
import { EditingPresenceNotice } from "@/components/molecules/EditingPresenceNotice";
import { DigestOrderPanel } from "@/components/molecules/DigestOrderPanel";
import type { StudioController } from "@/hooks/use-studio-controller";
import { formatMonth, submissionStatus } from "@/lib/workspace-formatters";

// 입력 완료된 Submission만 개별 HTML 또는 월 통합본으로 발행하는 편집자 화면입니다.
export function HtmlWorkspace({ studio }: { studio: StudioController }) {
  const {
    bookstores, month, htmlView, previewMode, htmlReady, selectedHtmlSubmission,
    selectedHtmlBookstore, generatedCode, generatedPreview, combinedHtml,
    setMonth, setHtmlView, setSelectedSubmissionId, setPreviewMode,
    downloadPhotoZip, updatePublished, notify, editingPresence, pendingAction,
  } = studio;
  const downloadPending = pendingAction === "download-photos" || pendingAction === "download-bundle";
  return <section className="html-workspace">
    <aside className="html-sidebar"><div><span>HTML WORKSPACE</span><h1>HTML 편집</h1></div><label><span>발행 월</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><nav><button className={htmlView === "individual" ? "active" : ""} onClick={() => setHtmlView("individual")}>개별 HTML <b>{htmlReady.length}</b></button><button className={htmlView === "digest" ? "active" : ""} onClick={() => setHtmlView("digest")}>통합본 만들기</button></nav>{htmlView === "individual" && <div className="ready-list">{htmlReady.map((submission) => { const bookstore = bookstores.find((item) => item.id === submission.bookstoreId); return <button className={selectedHtmlSubmission?.id === submission.id ? "selected" : ""} key={submission.id} onClick={() => setSelectedSubmissionId(submission.id)}><strong>{bookstore?.name}</strong><span>{submission.news.length}개 소식 · {submissionStatus(submission)}</span></button>; })}</div>}</aside>
    {htmlView === "individual" ? <div className="html-main">{selectedHtmlSubmission && selectedHtmlBookstore ? <><EditingPresenceNotice presence={editingPresence} /><div className="html-main-head"><div><span>{formatMonth(month)} · {selectedHtmlBookstore.region}</span><h2>{selectedHtmlBookstore.name}</h2><p>입력 완료된 내용만 표시됩니다.</p></div><div className="download-actions" aria-busy={downloadPending}><button className="secondary-button" onClick={() => void downloadPhotoZip(selectedHtmlSubmission, selectedHtmlBookstore, false)} disabled={downloadPending}>{pendingAction === "download-photos" ? "사진을 묶는 중..." : "사진 ZIP"}</button><button className="primary-button" title="미리보기 HTML, 복사용 TXT, 원본 사진을 한 번에 받습니다." onClick={() => void downloadPhotoZip(selectedHtmlSubmission, selectedHtmlBookstore, true)} disabled={downloadPending}>{pendingAction === "download-bundle" ? "작업 파일을 묶는 중..." : "HTML·TXT·사진 ZIP"}</button>{downloadPending && <small role="status" aria-live="polite">원본 사진을 모아 다운로드 파일을 준비하고 있어요.</small>}</div></div><div className="html-tabs"><button className={previewMode === "preview" ? "active" : ""} onClick={() => setPreviewMode("preview")}>HTML 미리보기</button><button className={previewMode === "code" ? "active" : ""} onClick={() => setPreviewMode("code")}>HTML 코드</button><button onClick={() => navigator.clipboard.writeText(generatedCode).then(() => notify("HTML 코드를 복사했습니다."))}>HTML 복사</button></div><div className="html-preview">{previewMode === "preview" ? <iframe title={`${selectedHtmlBookstore.name} HTML 미리보기`} srcDoc={`<!doctype html><html><body style="margin:0;background:#eee;padding:24px">${generatedPreview}</body></html>`} /> : <pre>{generatedCode}</pre>}</div><PublishPanel key={selectedHtmlSubmission.id} submission={selectedHtmlSubmission} onPublish={updatePublished} /></> : <div className="empty-state"><h2>입력 완료된 책방이 없습니다.</h2><p>정보 입력자가 입력을 마치면 이곳에 표시됩니다.</p></div>}</div> : <div className="digest-work">
      <DigestOrderPanel studio={studio} />
      <div className="digest-output"><div><span>통합 HTML 미리보기</span><button onClick={() => navigator.clipboard.writeText(combinedHtml).then(() => notify("통합 HTML을 복사했습니다."))}>HTML 복사</button></div><iframe title="통합 HTML 미리보기" srcDoc={`<!doctype html><html><body style="margin:0;background:#eee;padding:24px">${combinedHtml}</body></html>`} /></div>
    </div>}
  </section>;
}
