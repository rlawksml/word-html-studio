"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createDigestOrderClient, DigestOrderClientError, digestOrderAfterMove } from "@/lib/digest-order-client";
import { isCurrentDigestResponse, isDigestOrderMonth, projectDigestOrder, type DigestOrderRecord } from "@/lib/digest-order";
import { workspaceSessionHeaders } from "@/lib/workspace-client";
import type { Submission } from "@/lib/workspace-types";

type Phase = "loading" | "ready" | "unavailable" | "saving" | "error" | "conflict" | "unknown";
type State = { month: string; phase: Phase; order: DigestOrderRecord | null; message: string };
type Operation = { epoch: number; month: string; abort: AbortController };
type Options = {
  enabled: boolean;
  month: string;
  submissions: readonly Submission[];
  presenceOwned: boolean;
  refreshPresence: () => Promise<boolean>;
};

const LOADING = "책방 소식의 수록 순서를 불러오고 있습니다.";

// Dedicated order state never writes Submission arrays or participates in general autosave.
export function useDigestOrder({ enabled, month, submissions, presenceOwned, refreshPresence }: Options) {
  const client = useMemo(() => createDigestOrderClient({ sessionHeaders: workspaceSessionHeaders }), []);
  const [state, setState] = useState<State>({ month: "", phase: "loading", order: null, message: LOADING });
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const context = useRef({ month: "", epoch: 0, active: false });
  const busy = useRef<Operation | null>(null);
  const knownOrder = useRef<DigestOrderRecord | null>(null);
  const allowed = enabled && isDigestOrderMonth(month);
  const scope = allowed ? month : "";
  // Reset during render only when the context changes. React retries this render before
  // committing children, so reopening the same month cannot paint an old 'ready' frame.
  if (state.month !== scope) {
    setState({ month: scope, phase: "loading", order: null, message: LOADING });
  }

  // Commit-time invalidation closes the late-response gap before passive effects start.
  useLayoutEffect(() => {
    context.current = { month, epoch: context.current.epoch + 1, active: allowed };
    knownOrder.current = null;
    busy.current?.abort.abort();
    busy.current = null;
    return () => {
      context.current.active = false;
      context.current.epoch++;
      knownOrder.current = null;
      busy.current?.abort.abort();
      busy.current = null;
    };
  }, [allowed, month]);

  const current = useCallback((operation: Operation) => context.current.active
    && busy.current === operation
    && isCurrentDigestResponse(operation.month, context.current.month, operation.epoch, context.current.epoch), []);
  const start = useCallback((): Operation | null => {
    if (!context.current.active || busy.current) return null;
    const operation = { month: context.current.month, epoch: context.current.epoch, abort: new AbortController() };
    busy.current = operation;
    return operation;
  }, []);
  const finish = useCallback((operation: Operation) => {
    // An old finally must never unlock a new month's operation.
    if (busy.current === operation) busy.current = null;
  }, []);

  const reload = useCallback(async () => {
    const operation = start();
    if (!operation) return;
    knownOrder.current = null;
    setDraggedId(null);
    setState((previous) => ({ month: operation.month, phase: "loading", order: previous.month === operation.month ? previous.order : null, message: LOADING }));
    try {
      const result = await client.read(operation.month, operation.abort.signal);
      if (!current(operation)) return;
      knownOrder.current = result.available ? result.order : null;
      setState({ month: operation.month, phase: result.available ? "ready" : "unavailable", order: result.available ? result.order : null,
        message: result.available ? `${result.order.revision === 0 ? "기본" : "저장된"} 순서입니다. 손잡이로 순서를 변경하면 자동 저장됩니다.`
          : "통합본 순서 저장이 아직 설정되지 않았습니다. 미리보기와 복사는 사용할 수 있습니다." });
    } catch (error) {
      if (!current(operation)) return;
      setState((previous) => ({ ...previous, phase: "error", message: error instanceof DigestOrderClientError ? error.message : "통합본 순서를 불러오지 못했습니다." }));
    } finally { finish(operation); }
  }, [client, current, finish, start]);

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [allowed, month, reload]);

  const reorder = useCallback(async (targetId: number) => {
    const dragged = draggedId;
    setDraggedId(null);
    const order = knownOrder.current;
    if (dragged === null || dragged === targetId || !order || order.month !== month) return;
    const visible = projectDigestOrder(submissions, month, order.submissionIds).map((item) => item.id);
    if (!visible.includes(dragged) || !visible.includes(targetId)) return;
    const operation = start();
    if (!operation) return;
    setState((previous) => ({ ...previous, phase: "saving", message: "편집 권한을 확인하고 순서를 저장하고 있습니다." }));
    try {
      const requested = { month, submissionIds: digestOrderAfterMove(submissions, month, order.submissionIds, dragged, targetId), revision: order.revision };
      // A painted 'owned' badge is not authority: check the real lease immediately before PUT.
      const owned = await refreshPresence();
      if (!current(operation)) return;
      if (!owned) throw new DigestOrderClientError("DIGEST_ORDER_LEASE_REQUIRED", 423);
      const result = await client.save(requested, operation.abort.signal);
      if (!current(operation)) return;
      if (result.kind === "saved" || result.kind === "confirmed") {
        knownOrder.current = result.order;
        setState({ month, phase: "ready", order: result.order, message: result.kind === "confirmed" ? "응답이 지연되었지만 저장된 순서를 다시 확인했습니다." : "통합본 순서를 저장했습니다." });
      } else {
        knownOrder.current = null;
        setState((previous) => ({ ...previous, phase: result.kind === "conflict" ? "conflict" : "unknown", message: result.kind === "conflict"
          ? "다른 작업에서 순서가 변경되었습니다. 최신 순서를 불러온 뒤 다시 변경해 주세요."
          : "순서 저장 결과를 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다. 최신 순서를 불러와 주세요." }));
      }
    } catch (error) {
      if (!current(operation)) return;
      knownOrder.current = null;
      setState((previous) => ({ ...previous, phase: error instanceof DigestOrderClientError && error.code === "DIGEST_ORDER_CONFLICT" ? "conflict" : "error",
        message: error instanceof DigestOrderClientError ? error.message : "통합본 순서를 저장하지 못했습니다." }));
    } finally { finish(operation); }
  }, [client, current, draggedId, finish, month, refreshPresence, start, submissions]);

  const selected = state.month === scope ? state : { month: scope, phase: "loading" as const, order: null, message: LOADING };
  const digestReady = useMemo(() => isDigestOrderMonth(month)
    ? projectDigestOrder(submissions, month, selected.order?.submissionIds ?? []) : [], [month, selected.order, submissions]);
  return {
    digestReady, digestOrderPhase: selected.phase, digestOrderMessage: selected.message,
    digestOrderCanReorder: allowed && presenceOwned && selected.phase === "ready" && selected.order !== null,
    reloadDigestOrder: reload, reorderDigest: reorder,
    draggedDigestId: draggedId, setDraggedDigestId: setDraggedId,
  };
}
