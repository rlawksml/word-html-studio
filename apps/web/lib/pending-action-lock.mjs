/**
 * React 렌더링보다 빠르게 들어오는 연속 클릭도 한 번만 통과시키는 작은 비동기 작업 잠금입니다.
 * UI 상태 변경은 콜백으로 전달해 도메인 로직과 화면 표시가 같은 잠금 상태를 공유합니다.
 */
export function createPendingActionLock(onChange) {
  let current = null;

  return {
    begin(action) {
      if (current) return false;
      current = action;
      onChange(current);
      return true;
    },
    change(action) {
      current = action;
      onChange(current);
    },
    finish() {
      current = null;
      onChange(current);
    },
    get current() {
      return current;
    },
  };
}
