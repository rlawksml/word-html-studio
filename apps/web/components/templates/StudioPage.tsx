"use client";

import { AppHeader } from "@/components/molecules/AppHeader";
import { StorageAlert } from "@/components/molecules/StorageAlert";
import { StudioFeedback } from "@/components/molecules/StudioFeedback";
import { HtmlWorkspace } from "@/components/organisms/HtmlWorkspace";
import { InputWorkspace } from "@/components/organisms/InputWorkspace";
import { VisitorWorkspace } from "@/components/organisms/VisitorWorkspace";
import { useStudioController } from "@/hooks/use-studio-controller";

/**
 * 세 역할의 화면을 조립하는 Atomic Design의 template 계층입니다.
 * 상태와 업무 규칙은 controller에 두고, 이 컴포넌트는 현재 역할에 맞는 organism만 선택합니다.
 */
export function StudioPage() {
  const studio = useStudioController();
  return <main className={`app-shell role-${studio.role}`}>
    <AppHeader studio={studio} />
    <StorageAlert message={studio.storageError} />
    {studio.role === "visitor" && <VisitorWorkspace studio={studio} />}
    {studio.role === "input" && <InputWorkspace studio={studio} />}
    {studio.role === "html" && <HtmlWorkspace studio={studio} />}
    <StudioFeedback studio={studio} />
  </main>;
}
