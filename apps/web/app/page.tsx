import { StudioPage } from "@/components/templates/StudioPage";
import { currentKstMonth } from "@/lib/workspace-formatters";

// App Router 진입점입니다. 실제 화면 조립은 Atomic template인 StudioPage에서 시작합니다.
export default function Home() {
  // 서버가 한 번 계산한 KST 월을 hydration에도 그대로 사용합니다.
  return <StudioPage initialMonth={currentKstMonth()} />;
}
