import { EditingPresenceNotice } from "@/components/molecules/EditingPresenceNotice";
import type { StudioController } from "@/hooks/use-studio-controller";

// Drag belongs only to the handle. Selecting titles and toggling checkboxes stays ordinary text/UI work.
export function DigestOrderPanel({ studio }: { studio: StudioController }) {
  const { bookstores, digestReady, editingPresence, digestOrderCanReorder, digestOrderMessage,
    digestOrderPhase, reloadDigestOrder, draggedDigestId, setDraggedDigestId, reorderDigest, setSubmissions } = studio;
  const pending = digestOrderPhase === "loading" || digestOrderPhase === "saving";
  return <div className="digest-control">
    <EditingPresenceNotice presence={editingPresence} />
    <div><span>DIGEST ORDER</span><h2>통합본 수록 순서</h2><p>책방과 포함할 소식을 선택하고 손잡이를 끌어 순서를 바꿔보세요.</p></div>
    <div className="digest-order-status" aria-busy={pending}>
      <p role="status" aria-live="polite">{digestOrderMessage}</p>
      <button type="button" onClick={() => void reloadDigestOrder()} disabled={pending}>최신 순서 불러오기</button>
    </div>
    {digestReady.map((submission, index) => {
      const bookstore = bookstores.find((item) => item.id === submission.bookstoreId);
      return <article key={submission.id}
        onDragOver={(event) => { if (digestOrderCanReorder && draggedDigestId !== null) event.preventDefault(); }}
        onDrop={(event) => {
          event.preventDefault();
          if (digestOrderCanReorder) void reorderDigest(submission.id);
        }}>
        <header>
          <button type="button" className="digest-order-handle" draggable={digestOrderCanReorder}
            disabled={!digestOrderCanReorder} aria-label={`${bookstore?.name ?? "책방"} 수록 순서 이동`}
            title={digestOrderCanReorder ? "끌어서 수록 순서 변경" : "저장된 순서와 편집 상태를 먼저 확인해 주세요."}
            onDragStart={(event) => {
              if (!digestOrderCanReorder) { event.preventDefault(); return; }
              event.dataTransfer.setData("text/plain", String(submission.id));
              event.dataTransfer.effectAllowed = "move";
              setDraggedDigestId(submission.id);
            }}
            onDragEnd={() => setDraggedDigestId(null)}>⠿</button>
          <div><strong>{index + 1}. {bookstore?.name}</strong><small>{bookstore?.region}</small></div>
        </header>
        {submission.news.map((news) => <label key={news.id}><input type="checkbox" checked={news.includeInDigest}
          onChange={() => setSubmissions((current) => current.map((item) => item.id === submission.id
            ? { ...item, news: item.news.map((entry) => entry.id === news.id ? { ...entry, includeInDigest: !entry.includeInDigest } : entry) } : item))} />
          <span>{news.title}</span></label>)}
      </article>;
    })}
  </div>;
}
