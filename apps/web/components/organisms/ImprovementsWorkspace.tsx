"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ImprovementStatusChip } from "@/components/atoms/ImprovementStatusChip";
import { ImprovementTypeChip } from "@/components/atoms/ImprovementTypeChip";
import { UtilityPageHeader } from "@/components/molecules/UtilityPageHeader";
import { improvementsJson, improvementsMarkdown } from "@/lib/improvement-export";
import { createImprovement, loadImprovements, updateImprovement } from "@/lib/improvements-client";
import {
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STATUS_LABELS,
  type ImprovementRequest,
  type ImprovementRequestType,
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
  const [requestType, setRequestType] = useState<ImprovementRequestType>("bug");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
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
  const bugCount = useMemo(() => items.filter((item) => item.requestType === "bug").length, [items]);
  const improvementCount = items.length - bugCount;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSending(true);
      setMessage("");
      const submittedType = requestType;
      const response = await createImprovement({
        requestType,
        title,
        content,
        location,
        reason,
        website,
      });
      if (response.improvement) {
        const next = [response.improvement, ...items];
        setItems(next);
        seedDrafts(next);
      }
      setTitle("");
      setContent("");
      setLocation("");
      setReason("");
      setWebsite("");
      setError("");
      setMessage(`${submittedType === "bug" ? "버그" : "개선 제안"}을 접수했습니다. 진행 상태는 이 페이지에서 확인할 수 있습니다.`);
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
        <div><span>NEW REQUEST</span><h2>버그·개선 접수</h2><p>먼저 유형을 고르면 작성에 필요한 항목과 예시를 안내해 드립니다.</p></div>
        <div className="improvement-type-tabs" role="tablist" aria-label="접수 유형">
          <button type="button" role="tab" aria-selected={requestType === "bug"} onClick={() => setRequestType("bug")}>
            <strong>버그</strong><small>오류가 나거나 작동하지 않아요</small>
          </button>
          <button type="button" role="tab" aria-selected={requestType === "improvement"} onClick={() => setRequestType("improvement")}>
            <strong>개선</strong><small>더 편한 방법을 제안하고 싶어요</small>
          </button>
        </div>
        <p className="improvement-type-guide">
          {requestType === "bug"
            ? "어느 화면에서 어떤 순서로 사용했을 때 문제가 생겼는지 적어주시면 확인이 빨라집니다."
            : "현재 방식에서 무엇이 불편하고, 왜 바뀌면 좋은지 적어주시면 우선순위를 정하는 데 도움이 됩니다."}
        </p>
        <label><span>제목 <em>필수</em></span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={120} placeholder={requestType === "bug" ? "예: 사진을 첨부하면 400 오류가 나요" : "예: 사진을 두 장씩 묶어서 보여주고 싶어요"} required /></label>
        {requestType === "bug" && <label><span>버그 위치 또는 사용 경로 <em>필수</em></span><input value={location} onChange={(event) => setLocation(event.target.value)} minLength={2} maxLength={500} placeholder="예: 소식 입력 → 책방 선택 → 사진 첨부" required /></label>}
        <label><span>내용 <em>필수</em></span><textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={5} maxLength={4000} rows={8} placeholder={requestType === "bug" ? "사용한 순서, 화면에 나온 오류 문구, 같은 문제가 반복되는지 적어주세요." : "원하는 동작이나 화면 모습을 적어주세요. 현재 방식과 바뀌었으면 하는 방식을 함께 적으면 좋아요."} required /></label>
        {requestType === "improvement" && <label><span>필요한 이유 <em>필수</em></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={1000} rows={4} placeholder="예: 행사 사진이 많으면 화면이 너무 길어져서 한눈에 보기 어렵습니다." required /></label>}
        <label className="improvement-honeypot" aria-hidden="true"><span>웹사이트</span><input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
        <div className="improvement-form-footer"><small>{content.length.toLocaleString("ko-KR")} / 4,000자</small><button className="primary-button" type="submit" disabled={sending}>{sending ? "접수 중..." : requestType === "bug" ? "버그 접수하기" : "개선 제안 접수하기"}</button></div>
        {message && <p className="improvement-message" role="status">{message}</p>}
        {error && <p className="improvement-error" role="alert">{error}</p>}
      </form>

      <div className="improvement-board">
        <header>
          <div><span>REQUEST BOARD</span><h2>접수된 버그와 개선</h2><p>미해결 {unresolvedCount}건 · 버그 {bugCount}건 · 개선 {improvementCount}건</p></div>
          {canManage && items.length > 0 && <div className="improvement-export-actions">
            <button onClick={copySummary}>통합본 복사</button>
            <button onClick={() => downloadExport("md")}>MD 다운로드</button>
            <button onClick={() => downloadExport("json")}>JSON 다운로드</button>
          </div>}
        </header>
        {canManage && <p className="manager-mode">HTML 편집자 관리 모드 · 접수 내용을 확인하고 상태와 예정일을 변경할 수 있습니다.</p>}
        {loading ? <div className="improvement-empty"><strong>버그와 개선사항을 불러오고 있습니다.</strong><p>잠시만 기다려 주세요.</p></div> : items.length === 0 ? <div className="improvement-empty"><strong>아직 접수된 버그나 개선사항이 없습니다.</strong><p>첫 번째 의견을 남겨주세요.</p></div> : <div className="improvement-list">
          {items.map((item) => {
            const draft = drafts[item.id] || { status: item.status, targetDate: item.targetDate };
            return <article className={item.status === "resolved" ? "resolved" : ""} key={item.id}>
              <div className="improvement-card-head">
                <div className="improvement-chips"><ImprovementTypeChip requestType={item.requestType} /><ImprovementStatusChip status={item.status} />{item.targetDate && <span className="target-date-chip">{dateLabel(`${item.targetDate}T00:00:00+09:00`)} 예정</span>}</div>
                <time dateTime={item.createdAt}>{dateLabel(item.createdAt)} 접수</time>
              </div>
              <h3>{item.title}</h3>
              {item.requestType === "bug" && item.location && <p className="improvement-context"><strong>발생 위치/사용 경로</strong>{item.location}</p>}
              <p className="improvement-content">{item.content}</p>
              {item.requestType === "improvement" && item.reason && <p className="improvement-context"><strong>필요한 이유</strong>{item.reason}</p>}
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
