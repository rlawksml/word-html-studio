import type { Bookstore, LabeledLink, Submission } from "@/lib/workspace-types";
import { escapeHtml, formatDate, formatMonth, safeFilename, safeHref } from "@/lib/workspace-formatters";

/** 외부 HTML 편집기에 그대로 붙여넣을 수 있는 책방별 inline CSS HTML을 만듭니다. */
export function generatedHtml(submission: Submission, bookstore: Bookstore, includePreviewImages = false) {
  const sections = submission.news.map((news, newsIndex) => {
    const images = news.images.map((image, imageIndex) => {
      const filename = `${submission.month}_${safeFilename(bookstore.name)}_${String(newsIndex + 1).padStart(2, "0")}_${String(imageIndex + 1).padStart(2, "0")}_${safeFilename(news.title)}.${image.name.split(".").pop() || "jpg"}`;
      // 미리보기에는 공개 축소 이미지를 넣고, 다운로드 HTML에는 편집자가 교체할 파일명 표식을 남깁니다.
      if (includePreviewImages) return `<figure style="max-width:700px;margin:20px auto;text-align:center"><img src="${image.url}" alt="${escapeHtml(image.caption || news.title)}" style="display:block;width:auto;max-width:100%;height:auto;margin:0 auto">${image.caption ? `<figcaption style="margin-top:8px;color:#777;font-size:13px">${escapeHtml(image.caption)}</figcaption>` : ""}</figure>`;
      return `<!-- IMAGE: ${filename} -->`;
    }).join("\n");
    const dateText = news.dates.map(formatDate).join(", ");
    const schedule = news.scheduleText.trim() || dateText;
    const facts = [
      schedule ? ["일정", schedule] : null,
      news.deadline ? ["신청 마감", formatDate(news.deadline)] : null,
      news.place ? ["장소", news.place] : null,
      news.fee ? ["참가비", news.fee] : null,
      news.applicationInfo ? ["신청 방법", news.applicationInfo] : null,
      ...news.extraFields.filter((field) => field.label.trim() && field.value.trim()).map((field) => [field.label, field.value]),
    ].filter((item): item is string[] => Boolean(item));
    const links = [
      news.applyUrl ? { id: -1, label: "신청 및 자세히 보기", url: news.applyUrl } : null,
      ...news.links,
    ].filter((item): item is LabeledLink => Boolean(item && item.url.trim() && safeHref(item.url)));
    return `<section style="margin:34px 0">
  <h2 style="margin:0 0 14px;color:#2c3e50;font-size:1.5em;font-weight:600">${escapeHtml(news.title)}${news.displayLabel ? ` <span style="display:inline-block;padding:3px 8px;background:#8e735b;color:#fff;font-size:12px;vertical-align:middle">${escapeHtml(news.displayLabel)}</span>` : ""}</h2>
  ${news.regular ? '<span style="display:inline-block;margin-bottom:12px;padding:3px 8px;background:#eee;color:#555;font-size:12px">정기</span>' : ""}
  ${images}
  <div style="padding:22px;background:#f4f4f2;border:1px solid #ddd;border-radius:8px">
    <p style="margin:0 0 14px;line-height:1.8;white-space:pre-line">${escapeHtml(news.description)}</p>
    ${facts.map(([label, value]) => `<p style="margin:6px 0;white-space:pre-line"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("\n    ")}
    ${links.length ? `<p style="margin:14px 0 0">${links.map((link) => `<a href="${safeHref(link.url)}" style="display:inline-block;margin:0 12px 6px 0;color:#8e735b;font-weight:600;text-decoration:none">${escapeHtml(link.label || "관련 링크")} ↗</a>`).join("")}</p>` : ""}
  </div>
</section>`;
  }).join("\n");
  const bookstoreLinks = [
    bookstore.sns ? { id: -1, label: "SNS", url: bookstore.sns } : null,
    bookstore.website ? { id: -2, label: "홈페이지", url: bookstore.website } : null,
    ...(bookstore.links || []),
  ].filter((item): item is LabeledLink => Boolean(item && item.url.trim() && safeHref(item.url)));
  const contactLines = [
    bookstore.phone ? ["연락처", bookstore.phone] : null,
    ...(bookstore.contacts || []).filter((field) => field.label.trim() && field.value.trim()).map((field) => [field.label, field.value]),
  ].filter((item): item is string[] => Boolean(item));
  return `<div style="max-width:800px;margin:0 auto;background:#fff;padding:30px;font-family:'Apple SD Gothic Neo',Arial,sans-serif;line-height:1.65;color:#222">
  <h1 style="text-align:center;font-size:1.8em;font-weight:600;margin:0 0 28px">지관서가 전해주는 ${formatMonth(submission.month)} 소식 – ${escapeHtml(bookstore.name)}</h1>
  <div style="padding:18px;border-left:4px solid #8e735b;background:#f3efe8;margin-bottom:28px">
    <p style="margin:0;white-space:pre-line"><strong>${escapeHtml(bookstore.name)}</strong><br>${escapeHtml(bookstore.region)}${bookstore.address ? `<br>주소: ${escapeHtml(bookstore.address)}` : ""}${bookstore.hours ? `<br>영업시간: ${escapeHtml(bookstore.hours)}` : ""}${contactLines.map(([label, value]) => `<br>${escapeHtml(label)}: ${escapeHtml(value)}`).join("")}</p>
    ${bookstoreLinks.length ? `<p style="margin:10px 0 0">${bookstoreLinks.map((link) => `<a href="${safeHref(link.url)}" style="margin-right:12px;color:#8e735b;text-decoration:none">${escapeHtml(link.label || "관련 링크")} ↗</a>`).join("")}</p>` : ""}
    ${bookstore.introduction ? `<p style="margin:12px 0 0;color:#666">${escapeHtml(bookstore.introduction)}</p>` : ""}
  </div>
  ${submission.monthlyNotice ? `<div style="margin:0 0 28px;padding:14px 18px;background:#fff8e7;border:1px solid #ead8ad"><strong>이번 달 운영 안내</strong><p style="margin:6px 0 0;white-space:pre-line">${escapeHtml(submission.monthlyNotice)}</p></div>` : ""}
  ${sections}
</div>`;
}

/** 완료된 Submission에서 선택된 소식 제목만 모아 월 통합본 HTML을 만듭니다. */
export function digestHtml(submissions: Submission[], bookstores: Bookstore[], fallbackMonth: string) {
  const included = submissions.filter((submission) => submission.status === "completed");
  const blocks = included.map((submission) => {
    const bookstore = bookstores.find((item) => item.id === submission.bookstoreId);
    if (!bookstore) return "";
    const items = submission.news.filter((news) => news.includeInDigest).map((news) => `<li style="margin:9px 0">${escapeHtml(news.title)}</li>`).join("");
    return items ? `<section style="margin:0 0 30px"><h2 style="margin:0 0 10px;font-size:1.35em">${escapeHtml(bookstore.name)} <span style="font-size:.7em;color:#777">(${escapeHtml(bookstore.region)})</span></h2><ul style="margin:0;padding-left:22px">${items}</ul></section>` : "";
  }).join("\n");
  const month = included[0]?.month || fallbackMonth;
  return `<div style="max-width:900px;margin:0 auto;background:#fff;padding:32px;font-family:'Apple SD Gothic Neo',Arial,sans-serif;line-height:1.7;color:#222"><h1 style="text-align:center;font-size:1.9em;margin:0 0 36px">지관서가 전해주는 동네 책방 ${formatMonth(month)} 소식</h1>${blocks || "<p>포함된 소식이 없습니다.</p>"}</div>`;
}
