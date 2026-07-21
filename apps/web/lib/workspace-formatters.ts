import type { Bookstore, LabeledLink, LabeledValue, NewsItem, Submission } from "@/lib/workspace-types";

export type Role = "visitor" | "input" | "html";
export type LeaveTarget = "visitor" | "list";

export const BOOKSTORE_COLORS = ["#d96c5f", "#4f83a8", "#d19a3e", "#5f9274", "#8c6bb1", "#c56f9a", "#6f8f3d", "#b66d3f", "#397f86", "#7d756d"];
export const DISPLAY_LABELS = ["신청 중", "신청 마감", "행사 종료", "신규 모집", "상시 운영"];
export const INITIAL_MONTH = new Date().toISOString().slice(0, 7);

export const makeValue = (): LabeledValue => ({ id: Date.now() + Math.random(), label: "", value: "" });
export const makeLink = (): LabeledLink => ({ id: Date.now() + Math.random(), label: "", url: "" });
export const makeNews = (id = Date.now()): NewsItem => ({
  id,
  title: "",
  description: "",
  dates: [],
  scheduleText: "",
  regular: false,
  displayLabel: "",
  deadline: "",
  place: "",
  fee: "",
  applicationInfo: "",
  applyUrl: "",
  extraFields: [],
  links: [],
  images: [],
  includeInDigest: true,
});
export const makeSubmission = (bookstoreId: number, month: string): Submission => ({ id: Date.now(), bookstoreId, month, status: "draft", updatedAt: nowIso(), completedAt: "", publishedAt: "", publishedUrl: "", monthlyNotice: "", news: [makeNews()] });
export const blankBookstore = (): Bookstore => ({ id: Date.now(), name: "", region: "", address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [] });
export const hasSubmissionContent = (submission?: Submission) => Boolean(submission?.monthlyNotice.trim() || submission?.news.some((news) => news.title.trim() || news.description.trim() || news.dates.length || news.scheduleText.trim() || news.regular || news.displayLabel || news.deadline || news.place.trim() || news.fee.trim() || news.applicationInfo.trim() || news.applyUrl.trim() || news.extraFields.some((field) => field.label.trim() || field.value.trim()) || news.links.some((link) => link.label.trim() || link.url.trim()) || news.images.length));

export const nowIso = () => new Date().toISOString();
export const formatMonth = (month: string) => { const [year, value] = month.split("-"); return `${year}년 ${Number(value)}월`; };
export const formatDate = (value: string) => value ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00`)) : "";
export const formatSavedAt = (value: string) => value ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "아직 저장하지 않음";
export const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
export const safeClientHref = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
};
export const safeHref = (value: string) => escapeHtml(safeClientHref(value));
export const safeFilename = (value: string) => value.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").slice(0, 50);
export const shiftMonth = (month: string, amount: number) => { const date = new Date(`${month}-01T00:00:00`); date.setMonth(date.getMonth() + amount); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; };
export const previousMonth = (month: string) => shiftMonth(month, -1);
export const submissionStatus = (submission?: Submission) => !submission ? "미작성" : submission.publishedAt ? (new Date(submission.updatedAt) > new Date(submission.publishedAt) ? "재게시 필요" : "게시 완료") : submission.status === "completed" ? "입력 완료" : "작성 중";
