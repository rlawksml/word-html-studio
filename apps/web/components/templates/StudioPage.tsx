"use client";

import { lazy, Suspense } from "react";
import { AppHeader } from "@/components/molecules/AppHeader";
import { StorageAlert } from "@/components/molecules/StorageAlert";
import { StorageLoadingOverlay } from "@/components/molecules/StorageLoadingOverlay";
import { StudioFeedback } from "@/components/molecules/StudioFeedback";
import { VisitorWorkspace } from "@/components/organisms/VisitorWorkspace";
import { useStudioController } from "@/hooks/use-studio-controller";

// 작업자 전용 화면은 방문자가 암호를 통과했을 때만 내려받아 첫 화면의 JavaScript를 줄입니다.
const InputWorkspace = lazy(() => import("@/components/organisms/InputWorkspace").then((module) => ({ default: module.InputWorkspace })));
const HtmlWorkspace = lazy(() => import("@/components/organisms/HtmlWorkspace").then((module) => ({ default: module.HtmlWorkspace })));

/**
 * 세 역할의 화면을 조립하는 Atomic Design의 template 계층입니다.
 * 상태와 업무 규칙은 controller에 두고, 이 컴포넌트는 현재 역할에 맞는 organism만 선택합니다.
 */
export function StudioPage({ initialMonth }: { initialMonth: string }) {
  const studio = useStudioController(initialMonth);
  const dataReady = studio.initialLoadState.phase === "ready";
  return <>
    <main className={`app-shell role-${studio.role}`} aria-hidden={!dataReady || undefined} inert={!dataReady || undefined}>
      <AppHeader studio={studio} />
      <StorageAlert message={studio.storageError} onReload={studio.role === "visitor" ? undefined : studio.reloadWorkspace} />
      {studio.role === "visitor" && <VisitorWorkspace studio={studio} />}
      {studio.role === "input" && <Suspense fallback={<div className="role-loading" role="status">소식 입력 화면을 준비하고 있습니다.</div>}><InputWorkspace studio={studio} /></Suspense>}
      {studio.role === "html" && <Suspense fallback={<div className="role-loading" role="status">HTML 작업 화면을 준비하고 있습니다.</div>}><HtmlWorkspace studio={studio} /></Suspense>}
      <StudioFeedback studio={studio} />
    </main>
    {!dataReady && <StorageLoadingOverlay state={studio.initialLoadState} onRetry={studio.retryInitialLoad} />}
  </>;
}
