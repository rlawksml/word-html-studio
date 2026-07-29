import type { Metadata } from "next";
import { HelpWorkspace } from "@/components/organisms/HelpWorkspace";

export const metadata: Metadata = {
  title: "사용 가이드",
  description: "동네책방 소식 입력부터 사진 첨부와 입력 마무리까지, 처음 사용하는 분을 위한 단계별 안내입니다.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return <HelpWorkspace />;
}
