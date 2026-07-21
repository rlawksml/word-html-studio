export function StorageAlert({ message }: { message: string }) {
  if (!message) return null;
  return <div className="storage-alert" role="status"><strong>공용 저장소 연결을 확인해 주세요.</strong><span>{message}</span></div>;
}
