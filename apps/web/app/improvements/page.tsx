import type { Metadata } from "next";
import { ImprovementsWorkspace } from "@/components/organisms/ImprovementsWorkspace";

export const metadata: Metadata = { title: "개선사항 | 지관서가 동네책방 소식" };

export default function ImprovementsPage() {
  return <ImprovementsWorkspace />;
}
