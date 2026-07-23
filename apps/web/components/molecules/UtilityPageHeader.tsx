import { BrandIdentity } from "@/components/atoms/BrandIdentity";
import Link from "next/link";

type UtilityPage = "improvements" | "help";

export function UtilityPageHeader({ current }: { current: UtilityPage }) {
  return <header className="topbar utility-page-header">
    <Link className="brand" href="/" aria-label="동네책방 소식 홈"><BrandIdentity /></Link>
    <nav className="utility-nav" aria-label="도움 메뉴">
      <Link href="/improvements" aria-current={current === "improvements" ? "page" : undefined}>개선사항</Link>
      <Link href="/help" aria-current={current === "help" ? "page" : undefined}>도움말</Link>
    </nav>
  </header>;
}
