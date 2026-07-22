"use client";

import { useState } from "react";
import { NewsEditorCard } from "@/components/molecules/NewsEditorCard";
import { SubmissionPreviewDialog } from "@/components/molecules/SubmissionPreviewDialog";
import { EditingPresenceNotice } from "@/components/molecules/EditingPresenceNotice";
import type { StudioController } from "@/hooks/use-studio-controller";
import { formatMonth, makeNews } from "@/lib/workspace-formatters";

export function NewsEditorWorkspace({ studio }: { studio: StudioController }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const {
    bookstores, month, selectedBookstoreId, currentSubmission, saveState, setInputView,
    setSelectedBookstoreId, updateCurrent, copyPrevious, manualSave, completeSubmission, editingPresence,
  } = studio;
  if (!selectedBookstoreId || !currentSubmission) return null;
  const bookstore = bookstores.find((item) => item.id === selectedBookstoreId);
  if (!bookstore) return null;
  return <div className="single-editor">
    <div className="editor-page-head">
      <button className="back-button" onClick={() => { setInputView("list"); setSelectedBookstoreId(null); }}>← 책방 목록</button>
      <div><span>{bookstore.region} · {formatMonth(month)}</span><h1>{bookstore.name}</h1><p>{saveState}</p></div>
      <div className="editor-head-actions"><button className="secondary-button" onClick={() => setPreviewOpen(true)}>작성 내용 미리보기</button><button className="secondary-button" onClick={copyPrevious}>지난달 소식 불러오기</button></div>
    </div>
    <EditingPresenceNotice presence={editingPresence} />
    <section className="monthly-notice-card">
      <div><span>MONTHLY NOTICE</span><h2>이번 달 운영 안내 <em>선택</em></h2><p>임시 휴무, 이전, 이번 달만 달라지는 영업시간이 있을 때만 적어주세요.</p></div>
      <textarea rows={3} value={currentSubmission.monthlyNotice} onChange={(event) => updateCurrent((submission) => ({ ...submission, monthlyNotice: event.target.value }))} placeholder="예: 7월 15일은 내부 일정으로 쉽니다." />
    </section>
    {currentSubmission.news.map((news, index) => <NewsEditorCard key={news.id} studio={studio} news={news} index={index} total={currentSubmission.news.length} />)}
    <button className="add-news-button" onClick={() => updateCurrent((submission) => ({ ...submission, news: [...submission.news, makeNews()] }))}>＋ 소식 하나 더 추가</button>
    <div className="finish-bar"><div><strong>{bookstore.name} 소식 작성을 마치셨나요?</strong><small>{saveState}</small></div><div><button className="secondary-button" onClick={manualSave}>임시 저장</button><button className="primary-button" onClick={completeSubmission}>입력 마무리</button></div></div>
    {previewOpen && <SubmissionPreviewDialog bookstore={bookstore} submission={currentSubmission} onClose={() => setPreviewOpen(false)} />}
  </div>;
}
