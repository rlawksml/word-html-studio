"use client";

import { AppHeader } from "@/components/molecules/AppHeader";
import { StorageAlert } from "@/components/molecules/StorageAlert";
import { StudioFeedback } from "@/components/molecules/StudioFeedback";
import { HtmlWorkspace } from "@/components/organisms/HtmlWorkspace";
import { InputWorkspace } from "@/components/organisms/InputWorkspace";
import { VisitorWorkspace } from "@/components/organisms/VisitorWorkspace";
import { useStudioController } from "@/hooks/use-studio-controller";

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
