import type { Metadata } from "next";
import { HelpWorkspace } from "@/components/organisms/HelpWorkspace";

export const metadata: Metadata = { title: "사용 가이드 | 지관서가 동네책방 소식" };

export default function HelpPage() {
  return <HelpWorkspace />;
}
