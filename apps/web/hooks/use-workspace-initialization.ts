"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadWorkspace, workspaceSessionHeaders } from "@/lib/workspace-client";
import type { Role } from "@/lib/workspace-formatters";
import type { Workspace } from "@/lib/workspace-types";

const MAX_ATTEMPTS = 3;
const DELAY_NOTICE_MS = 8_000;
const ATTEMPT_TIMEOUT_MS = 12_000;

export type InitialLoadPhase = "loading" | "delayed" | "ready" | "empty" | "error";

export type InitialLoadState = {
  phase: InitialLoadPhase;
  attempt: number;
  maxAttempts: number;
  message: string;
};

class EmptyWorkspaceError extends Error {}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// 최초 세션 확인과 Workspace 로드를 controller에서 분리하고, 한 사이클을 42초 안에 세 번 시도합니다.
export function useWorkspaceInitialization(onReady: (workspace: Workspace, role: Role) => void) {
  const [state, setState] = useState<InitialLoadState>({
    phase: "loading",
    attempt: 1,
    maxAttempts: MAX_ATTEMPTS,
    message: "",
  });
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const startLoading = useCallback(() => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current?.abort();
    setState({ phase: "loading", attempt: 1, maxAttempts: MAX_ATTEMPTS, message: "" });

    void (async () => {
      let delayed = false;
      let lastFailureWasEmpty = false;
      let lastMessage = "동네 책방 소식을 불러오지 못했습니다.";
      const delayNoticeTimer = window.setTimeout(() => {
        if (runIdRef.current !== runId) return;
        delayed = true;
        setState((current) => current.phase === "loading" ? { ...current, phase: "delayed" } : current);
      }, DELAY_NOTICE_MS);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (runIdRef.current !== runId) return;
        if (attempt > 1) {
          setState({ phase: delayed ? "delayed" : "loading", attempt, maxAttempts: MAX_ATTEMPTS, message: "" });
        }

        const controller = new AbortController();
        abortRef.current = controller;
        const timeoutTimer = window.setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

        try {
          const savedRole = window.sessionStorage.getItem("bookstore-news-role") as Role | null;
          let workerSession = false;
          let restoredRole: Role = "visitor";

          if (savedRole === "input" || savedRole === "html") {
            const sessionResponse = await fetch("/api/session", {
              cache: "no-store",
              headers: workspaceSessionHeaders(),
              signal: controller.signal,
            });
            if (sessionResponse.ok) {
              workerSession = true;
              restoredRole = savedRole;
            } else if (sessionResponse.status === 401 || sessionResponse.status === 403) {
              window.sessionStorage.removeItem("bookstore-news-role");
              window.sessionStorage.removeItem("bookstore-news-session-id");
            } else {
              throw new Error("작업자 접속 상태를 확인하지 못했습니다.");
            }
          }

          const workspace = await loadWorkspace(workerSession, controller.signal);
          if (workspace.bookstores.length === 0) throw new EmptyWorkspaceError("등록된 책방 정보가 없습니다.");
          if (runIdRef.current !== runId) return;

          window.clearTimeout(delayNoticeTimer);
          onReadyRef.current(workspace, restoredRole);
          setState({ phase: "ready", attempt, maxAttempts: MAX_ATTEMPTS, message: "" });
          return;
        } catch (error) {
          if (runIdRef.current !== runId) return;
          lastFailureWasEmpty = error instanceof EmptyWorkspaceError;
          if (lastFailureWasEmpty) {
            lastMessage = "저장소에 등록된 책방 정보가 있는지 확인한 뒤 다시 시도해 주세요.";
          } else if (isAbortError(error)) {
            lastMessage = "연결 시간이 길어져 이번 확인을 마쳤습니다. 인터넷 연결을 확인해 주세요.";
          } else {
            lastMessage = error instanceof Error ? error.message : "동네 책방 소식을 불러오지 못했습니다.";
          }
        } finally {
          window.clearTimeout(timeoutTimer);
        }

        if (attempt < MAX_ATTEMPTS) {
          await wait(attempt * 2_000);
        }
      }

      if (runIdRef.current !== runId) return;
      window.clearTimeout(delayNoticeTimer);
      setState({
        phase: lastFailureWasEmpty ? "empty" : "error",
        attempt: MAX_ATTEMPTS,
        maxAttempts: MAX_ATTEMPTS,
        message: lastMessage,
      });
    })();
  }, []);

  useEffect(() => {
    // 브라우저 초기 paint 뒤 로드를 시작해 effect 안의 동기 상태 변경을 피합니다.
    const startTimer = window.setTimeout(startLoading, 0);
    return () => {
      window.clearTimeout(startTimer);
      runIdRef.current += 1;
      abortRef.current?.abort();
    };
  }, [startLoading]);

  return {
    initialLoadState: state,
    hydrated: state.phase === "ready",
    retryInitialLoad: startLoading,
  };
}
