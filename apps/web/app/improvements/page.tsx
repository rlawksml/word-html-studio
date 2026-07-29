import type { Metadata } from "next";
import { ImprovementsWorkspace } from "@/components/organisms/ImprovementsWorkspace";

export const metadata: Metadata = {
  title: "개선사항",
  description: "동네책방 소식 서비스의 버그와 개선 의견을 접수하고 처리 상태를 확인합니다.",
  robots: { index: false, follow: false },
};

export default function ImprovementsPage() {
  return <ImprovementsWorkspace />;
}
