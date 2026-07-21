import { BrandButton } from "@/components/atoms/BrandButton";
import type { StudioController } from "@/hooks/use-studio-controller";

export function AppHeader({ studio }: { studio: StudioController }) {
  const { role, returnToVisitor, setAccessRole, setPassword } = studio;
  return <header className="topbar">
    <BrandButton onClick={returnToVisitor} />
    {role === "visitor" ? <div className="staff-actions">
      <button className="staff-access" onClick={() => { setAccessRole("input"); setPassword(""); }}>소식 입력</button>
      <button className="staff-access" onClick={() => { setAccessRole("html"); setPassword(""); }}>HTML 편집</button>
    </div> : <div className="worker-nav"><span>{role === "input" ? "책방 정보 입력" : "HTML 편집"}</span><button onClick={returnToVisitor}>로그아웃</button></div>}
  </header>;
}
