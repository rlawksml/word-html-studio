"use client";

/* eslint-disable @next/next/no-img-element */

import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { formatDate, formatMonth, safeClientHref, submissionStatus } from "@/lib/workspace-formatters";
import type { Bookstore, LabeledLink, NewsItem, Submission } from "@/lib/workspace-types";

type PublicNewsDetailProps = {
  submission: Submission;
  news: NewsItem;
  bookstore: Bookstore;
  onClose: () => void;
};

export function PublicNewsDetail({ submission, news, bookstore, onClose }: PublicNewsDetailProps) {
  useBodyScrollLock();

  const status = submissionStatus(submission);
  const links = [
    news.applyUrl ? { id: -1, label: "신청 및 자세히 보기", url: news.applyUrl } : null,
    ...news.links,
  ].filter((item): item is LabeledLink => Boolean(item && safeClientHref(item.url)));
  return <div className="public-detail-backdrop" onMouseDown={onClose}>
    <article className="public-detail" role="dialog" aria-modal="true" aria-labelledby="public-detail-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="public-detail-close" onClick={onClose} aria-label="상세 소식 닫기">×</button>
      <header><span>{bookstore.region} · {formatMonth(submission.month)}</span><h2 id="public-detail-title">{news.title}</h2><div className="public-detail-badges"><i>{status}</i>{news.regular && <i>정기</i>}{news.displayLabel && <i>{news.displayLabel}</i>}</div></header>
      {news.images.length > 0 && <div className={`public-detail-photos${news.images.length === 1 ? " single-photo" : ""}`}>{news.images.map((image) => <figure key={image.id}><img src={image.url} alt={image.caption || news.title} loading="lazy" />{image.caption && <figcaption>{image.caption}</figcaption>}</figure>)}</div>}
      <p className="public-detail-description">{news.description}</p>
      <dl className="public-detail-facts">
        {(news.scheduleText || news.dates.length > 0) && <div><dt>일정</dt><dd>{news.scheduleText || news.dates.map(formatDate).join(", ")}</dd></div>}
        {news.deadline && <div><dt>신청 마감</dt><dd>{formatDate(news.deadline)}</dd></div>}
        {news.place && <div><dt>장소</dt><dd>{news.place}</dd></div>}
        {news.fee && <div><dt>참가비</dt><dd>{news.fee}</dd></div>}
        {news.applicationInfo && <div><dt>신청 방법</dt><dd>{news.applicationInfo}</dd></div>}
        {news.extraFields.filter((field) => field.label.trim() && field.value.trim()).map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
      </dl>
      {links.length > 0 && <div className="public-detail-links">{links.map((link) => <a key={link.id} href={safeClientHref(link.url)} target="_blank" rel="noreferrer">{link.label || "관련 링크"} ↗</a>)}</div>}
      {submission.monthlyNotice && <aside><strong>이번 달 운영 안내</strong><p>{submission.monthlyNotice}</p></aside>}
      <footer><strong>{bookstore.name}</strong><span>{bookstore.address || bookstore.region}</span>{submission.publishedUrl && <a href={safeClientHref(submission.publishedUrl)} target="_blank" rel="noreferrer">게시된 소식 보기 ↗</a>}</footer>
    </article>
  </div>;
}
