import { NewsCalendar } from "@/components/molecules/NewsCalendar";
import { PublicNewsDetail } from "@/components/molecules/PublicNewsDetail";
import type { StudioController } from "@/hooks/use-studio-controller";
import { formatDate, formatMonth } from "@/lib/workspace-formatters";

// 로그인하지 않은 방문자가 달력과 공개 소식을 탐색하는 읽기 전용 화면입니다.
export function VisitorWorkspace({ studio }: { studio: StudioController }) {
  const { month, search, selectedDay, publicEntries, filteredEntries, publicDetailData, bookstoreColor, setSearch, setPublicDetail } = studio;
  return <>
    <section className="visitor-page">
      <div className="visitor-hero"><span>JIGWANSEOGA LOCAL BOOKS</span><h1>{formatMonth(month)}<br />동네책방 소식</h1><a className="visitor-cta" href="https://jigwanseoga.org/133" target="_blank" rel="noreferrer">지관서가 동네책방 바로가기 ↗</a><div className="visitor-kpis"><strong>{publicEntries.length}<small>책방</small></strong><strong>{publicEntries.reduce((sum, item) => sum + item.submission.news.length, 0)}<small>소식</small></strong></div></div>
      <div className="visitor-content">
        <NewsCalendar studio={studio} />
        <div className="discovery-tools"><label><span className="sr-only">책방이나 소식 검색</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="책방이나 소식을 검색해 보세요" /></label></div>
        <div className="public-heading"><div><span>{selectedDay ? formatDate(selectedDay) : "이번 달"}</span><h2>{selectedDay ? "선택한 날짜의 소식" : "책방별 소식"}</h2></div><small>{filteredEntries.length}개 책방</small></div>
        <div className="public-feed">{filteredEntries.map(({ bookstore, submission }) => {
          const newsItems = selectedDay ? submission.news.filter((news) => news.dates.includes(selectedDay)) : submission.news;
          if (!newsItems.length) return null;
          return <article className="public-card" key={submission.id} style={{ borderTopColor: bookstoreColor(bookstore.id) }}><h3>{bookstore.name}</h3><ul className="public-event-list">{newsItems.map((news) => <li key={news.id}><button type="button" onClick={() => setPublicDetail({ submissionId: submission.id, newsId: news.id })}>{news.title}<span aria-hidden="true">›</span></button></li>)}</ul></article>;
        })}</div>
      </div>
    </section>
    {publicDetailData && <PublicNewsDetail {...publicDetailData} onClose={() => setPublicDetail(null)} />}
  </>;
}
