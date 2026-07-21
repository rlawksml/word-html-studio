import type { StudioController } from "@/hooks/use-studio-controller";
import { formatDate, formatMonth, shiftMonth } from "@/lib/workspace-formatters";

export function NewsCalendar({ studio }: { studio: StudioController }) {
  const { month, selectedDay, calendarDays, publicEntries, calendarItems, bookstoreColor, setMonth, setSelectedDay } = studio;
  return <section className="mobile-calendar">
    <div className="calendar-head">
      <button type="button" aria-label="이전 달" onClick={() => { setMonth(shiftMonth(month, -1)); setSelectedDay(""); }}>← 이전 달</button>
      <h2 aria-live="polite">{formatMonth(month)}</h2>
      <button type="button" aria-label="다음 달" onClick={() => { setMonth(shiftMonth(month, 1)); setSelectedDay(""); }}>다음 달 →</button>
    </div>
    <div className="weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{calendarDays.map((date, index) => {
      if (!date) return <span key={`blank-${index}`} />;
      const items = calendarItems(date);
      const tooltipId = `calendar-tooltip-${date}`;
      const itemLabel = items.map((item) => `${item.bookstore.name}: ${item.titles.join(", ")}`).join("; ");
      return <button key={date} className={`calendar-day ${selectedDay === date ? "selected" : ""}`} aria-label={`${formatDate(date)}${itemLabel ? `, ${itemLabel}` : ", 일정 없음"}`} aria-describedby={items.length ? tooltipId : undefined} aria-pressed={selectedDay === date} onClick={() => setSelectedDay((current) => current === date ? "" : date)}>
        <span className="calendar-date-number">{Number(date.slice(-2))}</span>
        {items.length > 0 && <><span className="calendar-markers" aria-hidden="true">{items.map((item) => <i key={item.bookstore.id} style={{ backgroundColor: item.color }} />)}</span><span className="calendar-tooltip" id={tooltipId} role="tooltip">{items.map((item) => <span key={item.bookstore.id}><i style={{ backgroundColor: item.color }} /><span><strong>{item.bookstore.name}</strong><small>{item.titles.join(" · ")}</small></span></span>)}</span></>}
      </button>;
    })}</div>
    <div className="calendar-legend" aria-label="책방 색상 안내">{publicEntries.map(({ bookstore }) => <span key={bookstore.id}><i style={{ backgroundColor: bookstoreColor(bookstore.id) }} />{bookstore.name}</span>)}</div>
  </section>;
}
