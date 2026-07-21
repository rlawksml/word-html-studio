"use client";

import { useState } from "react";
import type { Submission } from "@/lib/workspace-types";

export function PublishPanel({ submission, onPublish }: { submission: Submission; onPublish: (url: string) => void }) {
  const [url, setUrl] = useState(submission.publishedUrl);
  return <section className="publish-panel">
    <div><strong>{submission.publishedAt ? "게시 상태를 업데이트하시나요?" : "외부 게시판 게시를 마치셨나요?"}</strong><small>게시 URL은 선택사항이며 방문자 화면의 바로가기에 사용됩니다.</small></div>
    <label><span className="sr-only">게시 URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="게시 URL (선택)" /></label>
    <button className="primary-button" onClick={() => onPublish(url)}>{submission.publishedAt ? "재게시 완료" : "게시 완료"}</button>
  </section>;
}
