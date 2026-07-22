export function StorageAlert({ message, onReload }: { message: string; onReload?: () => void }) {
  if (!message) return null;
  return <div className="storage-alert" role="status"><strong>공용 저장소 연결을 확인해 주세요.</strong><span>{message}</span>{onReload && <button type="button" onClick={onReload}>최신 내용 다시 불러오기</button>}</div>;
}
