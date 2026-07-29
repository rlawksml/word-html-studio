import { BrandIdentity } from "@/components/atoms/BrandIdentity";

type BrandButtonProps = {
  onClick: () => void;
};

export function BrandButton({ onClick }: BrandButtonProps) {
  return <button className="brand" onClick={onClick} title="메인 페이지로 이동">
    <BrandIdentity />
  </button>;
}
