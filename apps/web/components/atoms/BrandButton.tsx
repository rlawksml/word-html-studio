type BrandButtonProps = {
  onClick: () => void;
};

export function BrandButton({ onClick }: BrandButtonProps) {
  return <button className="brand" onClick={onClick} aria-label="동네책방 소식 홈">
    <span className="brand-mark">止</span>
    <span><strong>止觀書架</strong><small>동네책방 소식</small></span>
  </button>;
}
