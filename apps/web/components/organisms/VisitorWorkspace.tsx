import { NewsCalendar } from "@/components/molecules/NewsCalendar";
import { PublicNewsDetail } from "@/components/molecules/PublicNewsDetail";
import type { StudioController } from "@/hooks/use-studio-controller";
import { formatDate, formatMonth } from "@/lib/workspace-formatters";
import { newsOccursOnDate } from "@/lib/news-schedule";

// 로그인하지 않은 방문자가 달력과 공개 소식을 탐색하는 읽기 전용 화면입니다.
export function VisitorWorkspace({ studio }: { studio: StudioController }) {
  const { month, search, selectedDay, publicEntries, filteredEntries, publicDetailData, bookstoreColor, setSearch, setPublicDetail } = studio;
  const publicNewsCount = publicEntries.reduce((sum, item) => sum + item.items.length, 0);
  return <>
    <section className="visitor-page">
      <div className="visitor-hero"><span>JIGWANSEOGA LOCAL BOOKS</span><h1>{formatMonth(month)}<br />동네책방 소식</h1><a className="visitor-cta" href="https://jigwanseoga.org/133" target="_blank" rel="noreferrer">지관서가 동네책방 바로가기 ↗</a><div className="visitor-kpis"><strong>{publicEntries.length}<small>책방</small></strong><strong>{publicNewsCount}<small>소식</small></strong></div></div>
      <div className="visitor-content">
        <NewsCalendar studio={studio} />
        <div className="discovery-tools"><label><span className="sr-only">책방이나 소식 검색</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="책방이나 소식을 검색해 보세요" /></label></div>
        <div className="public-heading"><div><span>{selectedDay ? formatDate(selectedDay) : "이번 달"}</span><h2>{selectedDay ? "선택한 날짜의 소식" : "책방별 소식"}</h2></div><small>{filteredEntries.length}개 책방</small></div>
        <div className="public-feed">{filteredEntries.map(({ bookstore, items }) => {
          // 제목이 비어 있는 작성 중 항목은 버튼 이름이 없어 접근성을 해치므로 공개 목록에서 제외합니다.
          const newsItems = selectedDay ? items.filter(({ news }) => newsOccursOnDate(news, selectedDay)) : items;
          if (!newsItems.length) return null;
          return <article className="public-card" key={bookstore.id} style={{ borderTopColor: bookstoreColor(bookstore.id) }}><h3>{bookstore.name}</h3><ul className="public-event-list">{newsItems.map(({ submission, news }) => <li key={`${submission.id}-${news.id}`}><button type="button" onClick={() => setPublicDetail({ submissionId: submission.id, newsId: news.id })}>{news.title}<span aria-hidden="true">›</span></button></li>)}</ul></article>;
        })}{publicEntries.length === 0 && <div className="empty-state"><h2>아직 등록된 동네책방 소식이 없습니다.</h2><p>소식 입력자가 첫 책방과 이번 달 이야기를 등록하면 이곳에 표시됩니다.</p></div>}{publicEntries.length > 0 && filteredEntries.length === 0 && <div className="empty-state"><h2>검색 결과가 없습니다.</h2><p>다른 책방 이름이나 소식 제목으로 찾아보세요.</p></div>}</div>
      </div>
    </section>
    {publicDetailData && <PublicNewsDetail {...publicDetailData} onClose={() => setPublicDetail(null)} />}
  </>;
}
