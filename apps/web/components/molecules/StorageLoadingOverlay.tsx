"use client";

import { LoadingBooks } from "@/components/atoms/LoadingBooks";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import type { InitialLoadState } from "@/hooks/use-workspace-initialization";

type StorageLoadingOverlayProps = {
  state: InitialLoadState;
  onRetry: () => void;
};

const ATTEMPT_COPY = [
  {
    title: "동네 책방에 잠시 들러 새로운 소식을 모으고 있어요.",
    description: "책방지기가 전해준 일정과 이야기를 차곡차곡 담는 중입니다.",
  },
  {
    title: "책방지기에게 이번 달 이야기를 한 번 더 확인하고 있어요.",
    description: "놓친 소식이 없도록 책방 목록과 달력을 다시 살펴보고 있습니다.",
  },
  {
    title: "마지막 책방까지 둘러보고 소식을 정리하고 있어요.",
    description: "조금만 기다리면 이번 달 동네 책방 이야기를 만나볼 수 있습니다.",
  },
] as const;

// 최초 데이터 준비가 끝날 때까지 빈 화면을 가리고, 지연·빈 데이터·연결 실패의 다음 행동을 안내합니다.
export function StorageLoadingOverlay({ state, onRetry }: StorageLoadingOverlayProps) {
  useBodyScrollLock();
  const pending = state.phase === "loading" || state.phase === "delayed";
  const delayed = state.phase === "delayed";
  const empty = state.phase === "empty";
  const failed = state.phase === "error";
  const copy = ATTEMPT_COPY[Math.min(state.attempt - 1, ATTEMPT_COPY.length - 1)];
  const title = delayed
    ? "책방으로 가는 길이 조금 막히네요."
    : empty
      ? "아직 전해 받은 책방 소식을 찾지 못했어요."
      : failed
        ? "책방 소식을 가져오는 길이 잠시 끊겼어요."
        : copy.title;
  const description = delayed
    ? "연결을 계속 확인하고 있어요. 조금 더 기다리거나 지금 다시 불러올 수 있습니다."
    : empty || failed
      ? state.message
      : copy.description;
  const showRetry = delayed || empty || failed;

  return <section
    className={`startup-loading phase-${state.phase}`}
    role={empty || failed ? "alert" : "status"}
    aria-live="polite"
    aria-busy={pending}
  >
    <div className="startup-loading-card">
      <div className="startup-loading-brand"><span>止觀</span><div><strong>동네책방 소식</strong><small>BOOKSTORE NEWS STUDIO</small></div></div>
      <div className="startup-loading-visual"><LoadingBooks moving={pending} /></div>
      <span className="startup-loading-eyebrow">A SHORT VISIT TO THE BOOKSTORE</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="startup-loading-progress" aria-label={`${state.maxAttempts}번 중 ${state.attempt}번째 연결 확인`}>
        {[...Array(state.maxAttempts)].map((_, index) => <i key={index} className={index < state.attempt ? "active" : ""} />)}
      </div>
      <small className="startup-loading-status">
        {pending ? `데이터 연결 중 · ${state.attempt}/${state.maxAttempts}번째 확인` : `총 ${state.maxAttempts}번 연결을 확인했습니다`}
      </small>
      {showRetry && <button type="button" onClick={onRetry}>{delayed ? "지금 다시 시도" : "다시 불러오기"}</button>}
    </div>
  </section>;
}
