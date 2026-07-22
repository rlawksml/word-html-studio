"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { heartbeatEditingPresence, releaseEditingPresence } from "@/lib/workspace-client";
import type { Role } from "@/lib/workspace-formatters";
import type { EditingPresence, EditingPresenceTarget } from "@/lib/workspace-types";

const HEARTBEAT_MS = 60_000;

type EditingPresenceOptions = {
  enabled: boolean;
  role: Role;
  target: EditingPresenceTarget | null;
};

const idlePresence: EditingPresence = { status: "idle", activeRole: null };

/**
 * 현재 탭이 실제 편집 화면을 열고 있을 때만 짧은 임대를 유지합니다. WebSocket 없이 1분 간격의
 * 요청만 사용하며, 탭 종료 알림이 실패해도 서버 임대가 3분 뒤 자동 만료됩니다.
 */
export function useEditingPresence({ enabled, role, target }: EditingPresenceOptions) {
  const [presence, setPresence] = useState<EditingPresence>(idlePresence);
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; }, [target]);

  const releasePresence = useCallback(() => {
    const current = targetRef.current;
    if (!current) return Promise.resolve();
    return releaseEditingPresence(current).then(() => undefined, () => undefined);
  }, []);

  useEffect(() => {
    if (!enabled || (role !== "input" && role !== "html") || !target) {
      const resetTimer = window.setTimeout(() => setPresence(idlePresence), 0);
      return () => window.clearTimeout(resetTimer);
    }

    let active = true;
    const heartbeat = async () => {
      if (document.visibilityState !== "visible") return;
      setPresence((current) => current.status === "idle" ? { status: "checking", activeRole: null } : current);
      try {
        const result = await heartbeatEditingPresence(target);
        if (active) setPresence({ status: result.owned ? "owned" : "occupied", activeRole: result.activeRole });
      } catch {
        if (active) setPresence({ status: "unavailable", activeRole: null });
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") void heartbeat(); };
    const handlePageHide = () => { void releaseEditingPresence(target).catch(() => undefined); };

    void heartbeat();
    const timer = window.setInterval(() => { void heartbeat(); }, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      void releaseEditingPresence(target).catch(() => undefined);
    };
  }, [enabled, role, target]);

  return { editingPresence: presence, releasePresence };
}
