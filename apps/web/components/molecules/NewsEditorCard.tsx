/* eslint-disable @next/next/no-img-element */

import type { StudioController } from "@/hooks/use-studio-controller";
import { DISPLAY_LABELS, formatDate, makeLink, makeValue } from "@/lib/workspace-formatters";
import type { NewsItem } from "@/lib/workspace-types";

type NewsEditorCardProps = {
  studio: StudioController;
  news: NewsItem;
  index: number;
  total: number;
};

// Submission 안의 NewsItem 하나를 편집하는 폼 단위입니다. 소식과 사진 정렬도 이 경계에서 처리합니다.
export function NewsEditorCard({ studio, news, index, total }: NewsEditorCardProps) {
  const {
    setDraggedNewsId, setDraggedImageId, reorderNews, moveNews, updateCurrent, updateNews,
    updateNewsValue, addImages, reorderImages, moveImage,
  } = studio;
  return <article className="news-editor-card" draggable onDragStart={() => setDraggedNewsId(news.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderNews(news.id)}>
    <div className="news-editor-head"><span className="drag-handle">⠿</span><div><small>소식 {index + 1}</small><h2>{news.title || "새 소식"}</h2></div><div className="reorder-buttons"><button onClick={() => moveNews(news.id, -1)} disabled={index === 0}>↑</button><button onClick={() => moveNews(news.id, 1)} disabled={index === total - 1}>↓</button><button className="danger" onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.filter((item) => item.id !== news.id) }))} disabled={total === 1}>삭제</button></div></div>
    <div className="form-grid">
      <label className="wide"><span>소식 제목 *</span><input data-required-field="title" value={news.title} onChange={(event) => updateNews(news.id, "title", event.target.value)} placeholder="예: 7월 중국어 원서 독서모임" /></label>
      <label className="wide"><span>상세 내용 *</span><textarea data-required-field="description" rows={7} value={news.description} onChange={(event) => updateNews(news.id, "description", event.target.value)} placeholder="Word에 작성하던 것처럼 내용을 자연스럽게 적어주세요." /></label>
      <label className="wide"><span>행사 날짜 <em>달력에 표시할 날짜 · 여러 개 가능</em></span><div className="date-list">{news.dates.map((date) => <span key={date}>{formatDate(date)}<button onClick={() => updateNews(news.id, "dates", news.dates.filter((item) => item !== date))}>×</button></span>)}<input type="date" value="" onChange={(event) => { if (event.target.value && !news.dates.includes(event.target.value)) updateNews(news.id, "dates", [...news.dates, event.target.value].sort()); }} /></div></label>
      <label className="wide"><span>일정 안내 <em>선택</em></span><input value={news.scheduleText} onChange={(event) => updateNews(news.id, "scheduleText", event.target.value)} placeholder="예: 7월 3일(목) 오후 7시~9시 / 매월 첫째 목요일" /></label>
      <label className="check-label"><input type="checkbox" checked={news.regular} onChange={(event) => updateNews(news.id, "regular", event.target.checked)} /><span>정기적으로 진행하는 소식입니다</span></label>
      <label><span>신청 마감일 <em>선택</em></span><input type="date" value={news.deadline} onChange={(event) => updateNews(news.id, "deadline", event.target.value)} /></label>
      <label className="wide"><span>사진 <em>선택 · 여러 장 가능</em></span><div className="upload-box" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files), news.id); }}><input type="file" accept="image/*" multiple onChange={(event) => { void addImages(Array.from(event.target.files || []), news.id); event.target.value = ""; }} /><strong>＋ 사진 첨부하기</strong><small>여러 사진을 끌어다 놓을 수 있습니다. 사진 한 장은 최대 20MB입니다.</small></div></label>
    </div>

    {news.images.length > 0 && <div className="photo-editor-grid">{news.images.map((image, imageIndex) => <figure key={image.id} draggable onDragStart={(event) => { event.stopPropagation(); setDraggedImageId(image.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); reorderImages(news.id, image.id); }}>
      <span className="photo-order">{imageIndex + 1}</span><img src={image.url} alt={image.caption || image.name} />
      <div className="photo-actions"><button onClick={() => moveImage(news.id, image.id, -1)} disabled={imageIndex === 0} aria-label="사진을 앞으로 이동">←</button><button onClick={() => moveImage(news.id, image.id, 1)} disabled={imageIndex === news.images.length - 1} aria-label="사진을 뒤로 이동">→</button><button className="remove-photo" onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.map((item) => item.id === news.id ? { ...item, images: item.images.filter((photo) => photo.id !== image.id) } : item) }))} aria-label="사진 삭제">×</button></div>
      <input value={image.caption} onChange={(event) => updateCurrent((submission) => ({ ...submission, news: submission.news.map((item) => item.id === news.id ? { ...item, images: item.images.map((photo) => photo.id === image.id ? { ...photo, caption: event.target.value } : photo) } : item) }))} placeholder="사진 설명 (선택)" />
    </figure>)}</div>}

    <details className="optional-fields">
      <summary><span>장소·참가비·신청 방법 등 추가 정보</span><small>필요할 때만 펼쳐서 입력하세요</small></summary>
      <div className="form-grid optional-fields-grid">
        <label><span>표시 라벨 <em>선택</em></span><select value={news.displayLabel} onChange={(event) => updateNews(news.id, "displayLabel", event.target.value)}><option value="">표시하지 않음</option>{DISPLAY_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}</select></label>
        <label><span>장소 <em>선택</em></span><input value={news.place} onChange={(event) => updateNews(news.id, "place", event.target.value)} /></label>
        <label><span>참가비 <em>선택</em></span><input value={news.fee} onChange={(event) => updateNews(news.id, "fee", event.target.value)} /></label>
        <label className="wide"><span>신청 방법 <em>선택</em></span><input value={news.applicationInfo} onChange={(event) => updateNews(news.id, "applicationInfo", event.target.value)} placeholder="예: 인스타그램 DM 또는 문자 010-0000-0000" /></label>
        <label className="wide"><span>대표 신청 링크 <em>선택</em></span><input value={news.applyUrl} onChange={(event) => updateNews(news.id, "applyUrl", event.target.value)} placeholder="https://..." /></label>
      </div>

      <div className="repeatable-section"><div><strong>자유로운 추가 항목</strong><small>대상, 정원, 선정 도서, 준비물처럼 필요한 정보만 추가하세요.</small></div>{news.extraFields.map((field) => <div className="repeatable-row" key={field.id}><input value={field.label} onChange={(event) => updateNewsValue(news.id, "extraFields", field.id, "label", event.target.value)} placeholder="항목 이름 (예: 선정 도서)" /><input value={field.value} onChange={(event) => updateNewsValue(news.id, "extraFields", field.id, "value", event.target.value)} placeholder="내용" /><button onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.map((item) => item.id === news.id ? { ...item, extraFields: item.extraFields.filter((entry) => entry.id !== field.id) } : item) }))}>삭제</button></div>)}<button className="text-add-button" onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.map((item) => item.id === news.id ? { ...item, extraFields: [...item.extraFields, makeValue()] } : item) }))}>＋ 항목 추가</button></div>

      <div className="repeatable-section"><div><strong>관련 링크</strong><small>신청 페이지, 소개 글, SNS 등 링크를 여러 개 넣을 수 있습니다.</small></div>{news.links.map((link) => <div className="repeatable-row" key={link.id}><input value={link.label} onChange={(event) => updateNewsValue(news.id, "links", link.id, "label", event.target.value)} placeholder="링크 이름" /><input value={link.url} onChange={(event) => updateNewsValue(news.id, "links", link.id, "url", event.target.value)} placeholder="https://..." /><button onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.map((item) => item.id === news.id ? { ...item, links: item.links.filter((entry) => entry.id !== link.id) } : item) }))}>삭제</button></div>)}<button className="text-add-button" onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.map((item) => item.id === news.id ? { ...item, links: [...item.links, makeLink()] } : item) }))}>＋ 링크 추가</button></div>
    </details>
  </article>;
}
