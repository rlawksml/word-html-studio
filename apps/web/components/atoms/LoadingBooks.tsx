type LoadingBooksProps = {
  moving?: boolean;
};

// 책 세 권이 차례로 움직이는 작은 브랜드형 로딩 표시입니다.
export function LoadingBooks({ moving = true }: LoadingBooksProps) {
  return <span className={`loading-books${moving ? " is-moving" : ""}`} aria-hidden="true">
    <i /><i /><i />
  </span>;
}
