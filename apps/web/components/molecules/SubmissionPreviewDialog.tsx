"use client";

import { useEffect } from "react";
import { generatedHtml } from "@/lib/html-generators";
import type { Bookstore, Submission } from "@/lib/workspace-types";

type SubmissionPreviewDialogProps = {
  bookstore: Bookstore;
  submission: Submission;
  onClose: () => void;
};

// 입력 완료 여부와 관계없이 현재 폼 값을 HTML 결과와 같은 모습으로 확인하는 입력자 전용 미리보기입니다.
export function SubmissionPreviewDialog({ bookstore, submission, onClose }: SubmissionPreviewDialogProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const previewHtml = generatedHtml(submission, bookstore, true);
  return <div className="submission-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="submission-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="submission-preview-title">
      <header>
        <div><span>작성 중인 내용</span><h2 id="submission-preview-title">{bookstore.name} 미리보기</h2><p>지금 입력한 내용과 사진 순서를 그대로 보여줍니다.</p></div>
        <button type="button" onClick={onClose} aria-label="미리보기 닫기">닫기</button>
      </header>
      <iframe
        title={`${bookstore.name} 작성 내용 미리보기`}
        sandbox=""
        srcDoc={`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eee;padding:24px">${previewHtml}</body></html>`}
      />
    </section>
  </div>;
}
