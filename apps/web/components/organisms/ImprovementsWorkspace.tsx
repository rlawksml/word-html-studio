"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ImprovementStatusChip } from "@/components/atoms/ImprovementStatusChip";
import { UtilityPageHeader } from "@/components/molecules/UtilityPageHeader";
import { improvementsJson, improvementsMarkdown } from "@/lib/improvement-export";
import { createImprovement, loadImprovements, updateImprovement } from "@/lib/improvements-client";
import {
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STATUS_LABELS,
  type ImprovementRequest,
  type ImprovementStatus,
} from "@/lib/improvement-types";
import { triggerDownload } from "@/lib/workspace-client";

type ImprovementDraft = {
  status: ImprovementStatus;
  targetDate: string;
};

const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
}).format(new Date(value));

export function ImprovementsWorkspace() {
  const [items, setItems] = useState<ImprovementRequest[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ImprovementDraft>>({});
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [website, setWebsite] = useState("");

  const seedDrafts = useCallback((improvements: ImprovementRequest[]) => {
    setDrafts(Object.fromEntries(improvements.map((item) => [item.id, {
      status: item.status,
      targetDate: item.targetDate,
    }])));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const response = await loadImprovements();
      setItems(response.improvements);
      setCanManage(response.canManage);
      seedDrafts(response.improvements);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "개선사항을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [seedDrafts]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const unresolvedCount = useMemo(() => items.filter((item) => item.status !== "resolved").length, [items]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSending(true);
      setMessage("");
      const response = await createImprovement(title, content, website);
      if (response.improvement) {
        const next = [response.improvement, ...items];
        setItems(next);
        seedDrafts(next);
      }
      setTitle("");
      setContent("");
      setWebsite("");
      setError("");
      setMessage("개선사항을 접수했습니다. 진행 상태는 이 페이지에서 확인할 수 있습니다.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "개선사항을 접수하지 못했습니다.");
    } finally {
      setSending(false);
    }
  };

  const saveStatus = async (item: ImprovementRequest) => {
    const draft = drafts[item.id];
    if (!draft) return;
    try {
      setSavingId(item.id);
      const response = await updateImprovement(item, draft.status, draft.targetDate);
      const next = items.map((current) => current.id === item.id ? response.improvement : current);
      setItems(next);
      seedDrafts(next);
      setError("");
      setMessage(`${item.title}의 진행 상태를 저장했습니다.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "진행 상태를 저장하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  };

  const downloadExport = (format: "md" | "json") => {
    const text = format === "md" ? improvementsMarkdown(items) : improvementsJson(items);
    triggerDownload(
      `동네책방_소식스튜디오_개선사항.${format}`,
      new Blob([text], { type: format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" }),
    );
  };

  const copySummary = async () => {
    await navigator.clipboard.writeText(improvementsMarkdown(items));
    setMessage("개선사항 통합본을 클립보드에 복사했습니다.");
  };

  return <main className="utility-shell">
    <UtilityPageHeader current="improvements" />
    <section className="utility-hero">
      <span>IMPROVEMENT REQUESTS</span>
      <h1>더 편한 동네책방 소식 스튜디오를 함께 만들어요.</h1>
      <p>사용하면서 불편했던 점이나 있었으면 하는 기능을 남겨주세요. 접수한 내용과 진행 상황을 누구나 확인할 수 있습니다.</p>
    </section>

    <section className="improvements-layout">
      <form className="improvement-form" onSubmit={submit}>
        <div><span>NEW REQUEST</span><h2>개선사항 접수</h2><p>제목과 내용만 적으면 됩니다. 기술적인 표현을 사용하지 않아도 괜찮습니다.</p></div>
        <label><span>제목 <em>필수</em></span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={120} placeholder="예: 사진 순서를 더 쉽게 바꾸고 싶어요" required /></label>
        <label><span>내용 <em>필수</em></span><textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={5} maxLength={4000} rows={8} placeholder="어떤 상황에서 불편했는지, 어떻게 바뀌면 좋을지 편하게 적어주세요." required /></label>
        <label className="improvement-honeypot" aria-hidden="true"><span>웹사이트</span><input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
        <div className="improvement-form-footer"><small>{content.length.toLocaleString("ko-KR")} / 4,000자</small><button className="primary-button" type="submit" disabled={sending}>{sending ? "접수 중..." : "개선사항 접수하기"}</button></div>
        {message && <p className="improvement-message" role="status">{message}</p>}
        {error && <p className="improvement-error" role="alert">{error}</p>}
      </form>

      <div className="improvement-board">
        <header>
          <div><span>REQUEST BOARD</span><h2>접수된 개선사항</h2><p>미해결 {unresolvedCount}건 · 전체 {items.length}건</p></div>
          {canManage && items.length > 0 && <div className="improvement-export-actions">
            <button onClick={copySummary}>통합본 복사</button>
            <button onClick={() => downloadExport("md")}>MD 다운로드</button>
            <button onClick={() => downloadExport("json")}>JSON 다운로드</button>
          </div>}
        </header>
        {canManage && <p className="manager-mode">작업자 관리 모드 · 상태와 예정일을 변경할 수 있습니다.</p>}
        {loading ? <div className="improvement-empty"><strong>개선사항을 불러오고 있습니다.</strong><p>잠시만 기다려 주세요.</p></div> : items.length === 0 ? <div className="improvement-empty"><strong>아직 접수된 개선사항이 없습니다.</strong><p>첫 번째 의견을 남겨주세요.</p></div> : <div className="improvement-list">
          {items.map((item) => {
            const draft = drafts[item.id] || { status: item.status, targetDate: item.targetDate };
            return <article className={item.status === "resolved" ? "resolved" : ""} key={item.id}>
              <div className="improvement-card-head">
                <div className="improvement-chips"><ImprovementStatusChip status={item.status} />{item.targetDate && <span className="target-date-chip">{dateLabel(`${item.targetDate}T00:00:00+09:00`)} 예정</span>}</div>
                <time dateTime={item.createdAt}>{dateLabel(item.createdAt)} 접수</time>
              </div>
              <h3>{item.title}</h3>
              <p className="improvement-content">{item.content}</p>
              {canManage && <div className="improvement-manager">
                <label><span>진행 상태</span><select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, status: event.target.value as ImprovementStatus } }))}>{IMPROVEMENT_STATUSES.map((status) => <option key={status} value={status}>{IMPROVEMENT_STATUS_LABELS[status]}</option>)}</select></label>
                <label><span>예정일 <em>선택</em></span><input type="date" value={draft.targetDate} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, targetDate: event.target.value } }))} /></label>
                <button className="secondary-button" type="button" disabled={savingId === item.id} onClick={() => void saveStatus(item)}>{savingId === item.id ? "저장 중..." : "상태 저장"}</button>
              </div>}
            </article>;
          })}
        </div>}
      </div>
    </section>
  </main>;
}
