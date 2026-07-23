import { BrandIdentity } from "@/components/atoms/BrandIdentity";

type BrandButtonProps = {
  onClick: () => void;
};

export function BrandButton({ onClick }: BrandButtonProps) {
  return <button className="brand" onClick={onClick} aria-label="동네책방 소식 홈">
    <BrandIdentity />
  </button>;
}
