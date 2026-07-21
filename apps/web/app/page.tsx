"use client";

/* eslint-disable @next/next/no-img-element */

import JSZip from "jszip";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Bookstore, LabeledLink, LabeledValue, NewsImage, NewsItem, Submission, WorkStatus, Workspace } from "@/lib/workspace-types";

type Role = "visitor" | "input" | "html";
type LeaveTarget = "visitor" | "list";

const BOOKSTORE_COLORS = ["#d96c5f", "#4f83a8", "#d19a3e", "#5f9274", "#8c6bb1", "#c56f9a", "#6f8f3d", "#b66d3f", "#397f86", "#7d756d"];

const makeValue = (): LabeledValue => ({ id: Date.now() + Math.random(), label: "", value: "" });
const makeLink = (): LabeledLink => ({ id: Date.now() + Math.random(), label: "", url: "" });
const makeNews = (id = Date.now()): NewsItem => ({ id, title: "", description: "", dates: [], scheduleText: "", regular: false, displayLabel: "", deadline: "", place: "", fee: "", applicationInfo: "", applyUrl: "", extraFields: [], links: [], images: [], includeInDigest: true });
const makeSubmission = (bookstoreId: number, month: string): Submission => ({ id: Date.now(), bookstoreId, month, status: "draft", updatedAt: nowIso(), completedAt: "", publishedAt: "", publishedUrl: "", monthlyNotice: "", news: [makeNews()] });
const blankBookstore = (): Bookstore => ({ id: Date.now(), name: "", region: "", address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [] });
const hasSubmissionContent = (submission?: Submission) => Boolean(submission?.monthlyNotice.trim() || submission?.news.some((news) => news.title.trim() || news.description.trim() || news.dates.length || news.scheduleText.trim() || news.regular || news.displayLabel || news.deadline || news.place.trim() || news.fee.trim() || news.applicationInfo.trim() || news.applyUrl.trim() || news.extraFields.some((field) => field.label.trim() || field.value.trim()) || news.links.some((link) => link.label.trim() || link.url.trim()) || news.images.length));

const INITIAL_MONTH = new Date().toISOString().slice(0, 7);
const DISPLAY_LABELS = ["신청 중", "신청 마감", "행사 종료", "신규 모집", "상시 운영"];
const nowIso = () => new Date().toISOString();
const formatMonth = (month: string) => { const [year, value] = month.split("-"); return `${year}년 ${Number(value)}월`; };
const formatDate = (value: string) => value ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00`)) : "";
const formatSavedAt = (value: string) => value ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "아직 저장하지 않음";
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const safeClientHref = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
};
const safeHref = (value: string) => escapeHtml(safeClientHref(value));
const safeFilename = (value: string) => value.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").slice(0, 50);
const shiftMonth = (month: string, amount: number) => { const date = new Date(`${month}-01T00:00:00`); date.setMonth(date.getMonth() + amount); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; };
const previousMonth = (month: string) => shiftMonth(month, -1);
const submissionStatus = (submission?: Submission) => !submission ? "미작성" : submission.publishedAt ? (new Date(submission.updatedAt) > new Date(submission.publishedAt) ? "재게시 필요" : "게시 완료") : submission.status === "completed" ? "입력 완료" : "작성 중";

function generatedHtml(submission: Submission, bookstore: Bookstore, includePreviewImages = false) {
  const sections = submission.news.map((news, newsIndex) => {
    const images = news.images.map((image, imageIndex) => {
      const filename = `${submission.month}_${safeFilename(bookstore.name)}_${String(newsIndex + 1).padStart(2, "0")}_${String(imageIndex + 1).padStart(2, "0")}_${safeFilename(news.title)}.${image.name.split(".").pop() || "jpg"}`;
      if (includePreviewImages) return `<figure style="margin:20px 0;text-align:center"><img src="${image.url}" alt="${escapeHtml(image.caption || news.title)}" style="display:block;width:100%;max-width:700px;height:auto;margin:0 auto">${image.caption ? `<figcaption style="margin-top:8px;color:#777;font-size:13px">${escapeHtml(image.caption)}</figcaption>` : ""}</figure>`;
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

function digestHtml(submissions: Submission[], bookstores: Bookstore[]) {
  const included = submissions.filter((submission) => submission.status === "completed");
  const blocks = included.map((submission) => {
    const bookstore = bookstores.find((item) => item.id === submission.bookstoreId);
    if (!bookstore) return "";
    const items = submission.news.filter((news) => news.includeInDigest).map((news) => `<li style="margin:9px 0">${escapeHtml(news.title)}</li>`).join("");
    return items ? `<section style="margin:0 0 30px"><h2 style="margin:0 0 10px;font-size:1.35em">${escapeHtml(bookstore.name)} <span style="font-size:.7em;color:#777">(${escapeHtml(bookstore.region)})</span></h2><ul style="margin:0;padding-left:22px">${items}</ul></section>` : "";
  }).join("\n");
  const month = included[0]?.month || INITIAL_MONTH;
  return `<div style="max-width:900px;margin:0 auto;background:#fff;padding:32px;font-family:'Apple SD Gothic Neo',Arial,sans-serif;line-height:1.7;color:#222"><h1 style="text-align:center;font-size:1.9em;margin:0 0 36px">지관서가 전해주는 동네 책방 ${formatMonth(month)} 소식</h1>${blocks || "<p>포함된 소식이 없습니다.</p>"}</div>`;
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function workspaceSessionHeaders() {
  const sessionId = window.sessionStorage.getItem("bookstore-news-session-id") || "";
  return sessionId ? { "x-workspace-session-id": sessionId } : {};
}

async function urlToBlob(url: string) {
  const response = await fetch(url, { headers: workspaceSessionHeaders() });
  if (!response.ok) throw new Error("사진을 내려받지 못했습니다.");
  return response.blob();
}

async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

async function loadWorkspace(worker = false): Promise<Workspace> {
  const response = await fetch("/api/workspace", { cache: "no-store", headers: worker ? workspaceSessionHeaders() : {} });
  if (!response.ok) throw new Error(await responseMessage(response, "공용 저장소를 불러오지 못했습니다."));
  return response.json() as Promise<Workspace>;
}

async function persistWorkspace(bookstores: Bookstore[], submissions: Submission[]) {
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({ bookstores, submissions }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "공용 저장소에 저장하지 못했습니다."));
}

function persistWorkspaceOnUnload(bookstores: Bookstore[], submissions: Submission[]) {
  const payload = new Blob([JSON.stringify({ bookstores, submissions, sessionId: window.sessionStorage.getItem("bookstore-news-session-id") || "" })], { type: "application/json" });
  navigator.sendBeacon("/api/workspace", payload);
}

async function createImagePreview(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxSize = 1280;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("사진 미리보기를 만들 수 없습니다.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("사진 미리보기를 만들 수 없습니다.")), "image/jpeg", .82));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-preview.jpg`, { type: "image/jpeg" });
}

export default function Home() {
  const [role, setRole] = useState<Role>("visitor");
  const [accessRole, setAccessRole] = useState<Exclude<Role, "visitor"> | null>(null);
  const [password, setPassword] = useState("");
  const [bookstores, setBookstores] = useState<Bookstore[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [month, setMonth] = useState(INITIAL_MONTH);
  const [selectedBookstoreId, setSelectedBookstoreId] = useState<number | null>(null);
  const [inputView, setInputView] = useState<"list" | "edit" | "bookstores">("list");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number>(1);
  const [htmlView, setHtmlView] = useState<"individual" | "digest">("individual");
  const [previewMode, setPreviewMode] = useState<"preview" | "code">("preview");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [toast, setToast] = useState("");
  const [saveState, setSaveState] = useState("모든 내용이 저장되었습니다");
  const [hydrated, setHydrated] = useState(false);
  const [draggedNewsId, setDraggedNewsId] = useState<number | null>(null);
  const [draggedImageId, setDraggedImageId] = useState<number | null>(null);
  const [draggedDigestId, setDraggedDigestId] = useState<number | null>(null);
  const [publicDetail, setPublicDetail] = useState<{ submissionId: number; newsId: number } | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<LeaveTarget | null>(null);
  const [storageError, setStorageError] = useState("");
  const skipAutoSaveRef = useRef(true);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const savedRole = window.sessionStorage.getItem("bookstore-news-role") as Role | null;
      try {
        let workerSession = false;
        if (savedRole === "input" || savedRole === "html") {
          const sessionResponse = await fetch("/api/session", { cache: "no-store", headers: workspaceSessionHeaders() });
          workerSession = sessionResponse.ok;
          if (workerSession) setRole(savedRole);
          else { window.sessionStorage.removeItem("bookstore-news-role"); window.sessionStorage.removeItem("bookstore-news-session-id"); }
        }
        const workspace = await loadWorkspace(workerSession);
        if (!active) return;
        setBookstores(workspace.bookstores);
        setSubmissions(workspace.submissions);
        setStorageError("");
      } catch (error) {
        if (!active) return;
        setBookstores([]);
        setSubmissions([]);
        setStorageError(error instanceof Error ? error.message : "공용 저장소를 불러오지 못했습니다.");
      } finally {
        if (active) setHydrated(true);
      }
    };
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipAutoSaveRef.current) { skipAutoSaveRef.current = false; return; }
    if (role !== "input" && role !== "html") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSaveState("공용 저장소에 저장 중...");
      void persistWorkspace(bookstores, submissions).then(() => {
        if (!active) return;
        setStorageError("");
        setSaveState(`자동 저장됨 · ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
      }).catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "공용 저장소에 저장하지 못했습니다.";
        setStorageError(message);
        setSaveState("자동 저장 실패");
      });
    }, 1200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [bookstores, hydrated, role, submissions]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const currentSubmission = submissions.find((item) => item.bookstoreId === selectedBookstoreId && item.month === month);
  const htmlReady = submissions.filter((item) => item.month === month && item.status === "completed");
  const selectedHtmlSubmission = htmlReady.find((item) => item.id === selectedSubmissionId) || htmlReady[0];
  const selectedHtmlBookstore = bookstores.find((item) => item.id === selectedHtmlSubmission?.bookstoreId);
  const generatedCode = selectedHtmlSubmission && selectedHtmlBookstore ? generatedHtml(selectedHtmlSubmission, selectedHtmlBookstore, false) : "";
  const generatedPreview = selectedHtmlSubmission && selectedHtmlBookstore ? generatedHtml(selectedHtmlSubmission, selectedHtmlBookstore, true) : "";
  const combinedHtml = useMemo(() => digestHtml(htmlReady, bookstores), [bookstores, htmlReady]);

  const monthSubmissions = submissions.filter((item) => item.month === month);
  const completedBookstoreCount = monthSubmissions.filter((item) => item.status === "completed").length;
  const completionPercent = bookstores.length ? Math.round((completedBookstoreCount / bookstores.length) * 100) : 0;
  const publicEntries = monthSubmissions.map((submission) => ({ submission, bookstore: bookstores.find((item) => item.id === submission.bookstoreId)! })).filter((item) => item.bookstore && item.submission.news.some((news) => news.title.trim()));
  const filteredEntries = publicEntries.filter(({ bookstore, submission }) => {
    const haystack = `${bookstore.name} ${bookstore.region} ${submission.news.map((news) => `${news.title} ${news.description} ${news.place}`).join(" ")}`.toLowerCase();
    return haystack.includes(debouncedSearch.toLowerCase());
  }).sort((a, b) => {
    const aDate = a.submission.news.flatMap((news) => news.dates).sort()[0] || "9999-12-31";
    const bDate = b.submission.news.flatMap((news) => news.dates).sort()[0] || "9999-12-31";
    return aDate.localeCompare(bDate);
  });
  const publicDetailData = publicDetail ? (() => {
    const submission = submissions.find((item) => item.id === publicDetail.submissionId);
    const news = submission?.news.find((item) => item.id === publicDetail.newsId);
    const bookstore = bookstores.find((item) => item.id === submission?.bookstoreId);
    return submission && news && bookstore ? { submission, news, bookstore } : null;
  })() : null;
  const hasDraftInProgress = role === "input" && inputView === "edit" && currentSubmission?.status === "draft" && hasSubmissionContent(currentSubmission);

  useEffect(() => {
    if (!hasDraftInProgress) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      persistWorkspaceOnUnload(bookstores, submissions);
      event.preventDefault();
      event.returnValue = "";
    };
    const handleNavigationClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest(".brand, .worker-nav button, .editor-page-head .back-button") : null;
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTarget(element.matches(".editor-page-head .back-button") ? "list" : "visitor");
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleNavigationClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleNavigationClick, true);
    };
  }, [bookstores, hasDraftInProgress, submissions]);

  const login = async () => {
    const normalizedPassword = password.normalize("NFC").trim();
    if (!accessRole) return;
    try {
      const sessionId = crypto.randomUUID();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: accessRole, code: normalizedPassword, sessionId }),
      });
      if (!response.ok) { notify(await responseMessage(response, "작업 암호를 확인해 주세요.")); return; }
      window.sessionStorage.setItem("bookstore-news-role", accessRole);
      window.sessionStorage.setItem("bookstore-news-session-id", sessionId);
      const workspace = await loadWorkspace(true);
      setBookstores(workspace.bookstores);
      setSubmissions(workspace.submissions);
      setRole(accessRole);
      setAccessRole(null);
      setPassword("");
      setStorageError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "작업 화면에 접속하지 못했습니다.";
      setStorageError(message);
      notify(message);
    }
  };

  const resetVisitorPage = () => {
    setMonth(INITIAL_MONTH);
    setSelectedDay("");
    setSearch("");
    setDebouncedSearch("");
    setPublicDetail(null);
  };

  const goToBookstoreList = () => {
    setInputView("list");
    setSelectedBookstoreId(null);
    setLeaveTarget(null);
  };

  const returnToVisitor = () => {
    void fetch("/api/session", { method: "DELETE" });
    window.sessionStorage.removeItem("bookstore-news-role");
    window.sessionStorage.removeItem("bookstore-news-session-id");
    resetVisitorPage();
    setRole("visitor");
    setInputView("list");
    setSelectedBookstoreId(null);
    setAccessRole(null);
    setPassword("");
    setLeaveTarget(null);
  };

  const confirmLeave = async () => {
    if (!leaveTarget) return;
    try {
      await persistWorkspace(bookstores, submissions);
      setStorageError("");
      if (leaveTarget === "visitor") returnToVisitor();
      else goToBookstoreList();
    } catch (error) {
      const message = error instanceof Error ? error.message : "임시 저장하지 못했습니다.";
      setStorageError(message);
      notify(message);
    }
  };

  const ensureSubmission = (bookstoreId: number) => {
    const existing = submissions.find((item) => item.bookstoreId === bookstoreId && item.month === month);
    if (existing) return existing.id;
    const next = makeSubmission(bookstoreId, month);
    setSubmissions((current) => [...current, next]);
    return next.id;
  };

  const openBookstore = (bookstoreId: number) => {
    ensureSubmission(bookstoreId);
    setSelectedBookstoreId(bookstoreId);
    setInputView("edit");
  };

  const updateCurrent = (change: (submission: Submission) => Submission) => {
    if (!currentSubmission) return;
    setSubmissions((current) => current.map((item) => {
      if (item.id !== currentSubmission.id) return item;
      const changed = change(item);
      const retainedImageIds = new Set(changed.news.flatMap((news) => news.images.map((image) => image.id)));
      item.news.flatMap((news) => news.images).filter((image) => !retainedImageIds.has(image.id)).forEach(deleteStoredImage);
      return { ...changed, status: item.status === "completed" ? "draft" : item.status, updatedAt: nowIso() };
    }));
  };

  const updateNews = (newsId: number, key: keyof NewsItem, value: string | boolean | string[]) => updateCurrent((submission) => ({ ...submission, news: submission.news.map((news) => news.id === newsId ? { ...news, [key]: value } : news) }));

  const updateNewsValue = (newsId: number, collection: "extraFields" | "links", itemId: number, key: string, value: string) => updateCurrent((submission) => ({
    ...submission,
    news: submission.news.map((news) => news.id === newsId ? { ...news, [collection]: news[collection].map((item) => item.id === itemId ? { ...item, [key]: value } : item) } : news),
  }));

  const addImages = async (files: File[], newsId: number) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) { notify("이미지 파일만 첨부할 수 있습니다."); return; }
    if (!selectedBookstoreId) return;
    const uploaded: NewsImage[] = [];
    try {
      setSaveState(`사진 ${images.length}장 업로드 중...`);
      for (const file of images) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: 사진 한 장은 20MB 이하로 업로드해 주세요.`);
        const preview = await createImagePreview(file);
        const form = new FormData();
        form.append("original", file);
        form.append("preview", preview);
        form.append("month", month);
        form.append("bookstoreId", String(selectedBookstoreId));
        form.append("newsId", String(newsId));
        const response = await fetch("/api/images", { method: "POST", headers: workspaceSessionHeaders(), body: form });
        if (!response.ok) throw new Error(await responseMessage(response, "사진을 저장하지 못했습니다."));
        uploaded.push(await response.json() as NewsImage);
      }
      updateCurrent((submission) => ({ ...submission, news: submission.news.map((news) => news.id === newsId ? { ...news, images: [...news.images, ...uploaded] } : news) }));
      setStorageError("");
      setSaveState("사진 업로드 완료 · 내용 저장 중...");
      notify(`사진 ${uploaded.length}장을 저장했습니다.`);
    } catch (error) {
      uploaded.forEach(deleteStoredImage);
      const message = error instanceof Error ? error.message : "사진을 저장하지 못했습니다.";
      setStorageError(message);
      setSaveState("사진 업로드 실패");
      notify(message);
    }
  };

  function deleteStoredImage(image: NewsImage) {
    if (!image.originalPath && !image.previewPath) return;
    void fetch("/api/images", {
      method: "DELETE",
      headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
      body: JSON.stringify({ originalPath: image.originalPath, previewPath: image.previewPath }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await responseMessage(response, "사진 파일을 정리하지 못했습니다."));
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "사진 파일을 정리하지 못했습니다.";
      setStorageError(message);
      notify(message);
    });
  }

  const reorderNews = (targetId: number) => {
    if (!currentSubmission || draggedNewsId === null || draggedNewsId === targetId) return;
    const next = [...currentSubmission.news];
    const from = next.findIndex((item) => item.id === draggedNewsId);
    const to = next.findIndex((item) => item.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateCurrent((submission) => ({ ...submission, news: next }));
    setDraggedNewsId(null);
  };

  const moveNews = (newsId: number, direction: -1 | 1) => {
    if (!currentSubmission) return;
    const next = [...currentSubmission.news];
    const index = next.findIndex((item) => item.id === newsId);
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateCurrent((submission) => ({ ...submission, news: next }));
  };

  const reorderImages = (newsId: number, targetId: number) => {
    if (draggedImageId === null || draggedImageId === targetId) return;
    updateCurrent((submission) => ({ ...submission, news: submission.news.map((news) => {
      if (news.id !== newsId) return news;
      const images = [...news.images];
      const from = images.findIndex((image) => image.id === draggedImageId);
      const to = images.findIndex((image) => image.id === targetId);
      if (from < 0 || to < 0) return news;
      const [moved] = images.splice(from, 1);
      images.splice(to, 0, moved);
      return { ...news, images };
    }) }));
    setDraggedImageId(null);
  };

  const moveImage = (newsId: number, imageId: number, direction: -1 | 1) => {
    updateCurrent((submission) => ({ ...submission, news: submission.news.map((news) => {
      if (news.id !== newsId) return news;
      const images = [...news.images];
      const index = images.findIndex((image) => image.id === imageId);
      const target = index + direction;
      if (target < 0 || target >= images.length) return news;
      [images[index], images[target]] = [images[target], images[index]];
      return { ...news, images };
    }) }));
  };

  const copyPrevious = () => {
    if (!selectedBookstoreId || !currentSubmission) return;
    const previous = submissions.find((item) => item.bookstoreId === selectedBookstoreId && item.month === previousMonth(month));
    if (!previous) { notify("지난달에 복사할 소식이 없습니다."); return; }
    const copied = previous.news.map((news) => ({ ...news, id: Date.now() + Math.random(), dates: [], scheduleText: "", deadline: "", applicationInfo: "", applyUrl: "", fee: "", displayLabel: "", images: [] }));
    updateCurrent((submission) => ({ ...submission, news: copied }));
    notify(`${formatMonth(previous.month)} 소식을 불러왔습니다. 일정·신청·참가비를 다시 확인해 주세요.`);
  };

  const manualSave = async () => {
    try {
      setSaveState("공용 저장소에 저장 중...");
      await persistWorkspace(bookstores, submissions);
      setStorageError("");
      setSaveState(`임시 저장됨 · ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
      notify("임시 저장했습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "임시 저장하지 못했습니다.";
      setStorageError(message);
      setSaveState("임시 저장 실패");
      notify(message);
    }
  };

  const completeSubmission = () => {
    if (!currentSubmission) return;
    const incompleteNewsIndex = currentSubmission.news.findIndex((news) => !news.title.trim() || !news.description.trim());
    if (incompleteNewsIndex >= 0) {
      const incompleteNews = currentSubmission.news[incompleteNewsIndex];
      const missingField = !incompleteNews.title.trim() ? "title" : "description";
      const missingLabel = missingField === "title" ? "소식 제목" : "상세 내용";
      const newsCard = document.querySelectorAll<HTMLElement>(".news-editor-card")[incompleteNewsIndex];
      const field = newsCard?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-required-field="${missingField}"]`);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
      field?.classList.add("field-needs-attention");
      window.setTimeout(() => field?.classList.remove("field-needs-attention"), 2400);
      notify(`소식 ${incompleteNewsIndex + 1}의 ${missingLabel}을 입력해 주세요.`);
      return;
    }
    const completed = { ...currentSubmission, status: "completed" as WorkStatus, completedAt: nowIso(), updatedAt: nowIso() };
    setSubmissions((current) => current.map((item) => item.id === completed.id ? completed : item));
    setInputView("list");
    setSelectedBookstoreId(null);
    notify("책방 소식 입력을 완료했습니다.");
  };

  const completionShareMessage = () => {
    const complete = monthSubmissions.filter((item) => item.status === "completed");
    const newsCount = complete.reduce((sum, item) => sum + item.news.length, 0);
    const bookstoreDetails = complete.map((submission) => {
      const bookstore = bookstores.find((item) => item.id === submission.bookstoreId);
      const newsTitles = submission.news.map((news) => `  - ${news.title}`).join("\n");
      return `• ${bookstore?.name || "등록된 책방"}\n${newsTitles}`;
    }).join("\n\n");
    return `📚 ${formatMonth(month)} 동네책방 소식 입력을 완료했습니다!\n\n총 ${complete.length}개 책방, ${newsCount}가지 소식이 업로드되었습니다. 🎉\n\n${bookstoreDetails}\n\nHTML 작업을 진행해 주세요. 😊`;
  };

  const copyText = async (text: string) => { await navigator.clipboard.writeText(text); notify("메시지를 복사했습니다."); };

  const downloadPhotoZip = async (submission: Submission, bookstore: Bookstore, withHtml: boolean) => {
    const zip = new JSZip();
    const imageFolder = zip.folder("사진");
    for (let newsIndex = 0; newsIndex < submission.news.length; newsIndex += 1) {
      const news = submission.news[newsIndex];
      for (let imageIndex = 0; imageIndex < news.images.length; imageIndex += 1) {
        const item = news.images[imageIndex];
        const extension = item.name.split(".").pop() || "jpg";
        const filename = `${submission.month}_${safeFilename(bookstore.name)}_${String(newsIndex + 1).padStart(2, "0")}_${String(imageIndex + 1).padStart(2, "0")}_${safeFilename(news.title)}.${extension}`;
        imageFolder?.file(filename, await urlToBlob(item.originalUrl || item.url));
      }
    }
    if (withHtml) {
      zip.file(`${submission.month}_${safeFilename(bookstore.name)}.html`, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${bookstore.name}</title></head><body>${generatedHtml(submission, bookstore, false)}</body></html>`);
      zip.file("사진배치안내.txt", submission.news.map((news, index) => `${index + 1}. ${news.title}\n${news.images.map((image, imageIndex) => `- ${submission.month}_${safeFilename(bookstore.name)}_${String(index + 1).padStart(2, "0")}_${String(imageIndex + 1).padStart(2, "0")}_${safeFilename(news.title)}.${image.name.split(".").pop() || "jpg"}`).join("\n")}`).join("\n\n"));
    }
    triggerDownload(`${submission.month}_${safeFilename(bookstore.name)}_${withHtml ? "작업파일" : "사진"}.zip`, await zip.generateAsync({ type: "blob" }));
  };

  const reorderDigest = (targetId: number) => {
    if (draggedDigestId === null || targetId === draggedDigestId) return;
    const monthIndexes = submissions.map((item, index) => item.month === month && item.status === "completed" ? index : -1).filter((index) => index >= 0);
    const ordered = monthIndexes.map((index) => submissions[index]);
    const from = ordered.findIndex((item) => item.id === draggedDigestId);
    const to = ordered.findIndex((item) => item.id === targetId);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const next = [...submissions];
    monthIndexes.forEach((sourceIndex, index) => { next[sourceIndex] = ordered[index]; });
    setSubmissions(next);
    setDraggedDigestId(null);
  };

  const updatePublished = (url: string) => {
    if (!selectedHtmlSubmission) return;
    setSubmissions((current) => current.map((item) => item.id === selectedHtmlSubmission.id ? { ...item, publishedAt: nowIso(), publishedUrl: url } : item));
    notify("게시 완료로 표시했습니다.");
  };

  const calendarDays = useMemo(() => {
    const [year, numericMonth] = month.split("-").map(Number);
    const first = new Date(year, numericMonth - 1, 1).getDay();
    const count = new Date(year, numericMonth, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
  }, [month]);

  const bookstoreColor = (bookstoreId: number) => BOOKSTORE_COLORS[Math.max(0, bookstores.findIndex((bookstore) => bookstore.id === bookstoreId)) % BOOKSTORE_COLORS.length];
  const calendarItems = (date: string) => publicEntries.flatMap(({ bookstore, submission }) => {
    const titles = submission.news.filter((news) => news.dates.includes(date)).map((news) => news.title);
    return titles.length ? [{ bookstore, titles, color: bookstoreColor(bookstore.id) }] : [];
  });

  return (
    <main className={`app-shell role-${role}`}>
      <header className="topbar">
        <button className="brand" onClick={returnToVisitor} aria-label="동네책방 소식 홈"><span className="brand-mark">止</span><span><strong>止觀書架</strong><small>동네책방 소식</small></span></button>
        {role === "visitor" ? <div className="staff-actions"><button className="staff-access" onClick={() => { setAccessRole("input"); setPassword(""); }}>소식 입력</button><button className="staff-access" onClick={() => { setAccessRole("html"); setPassword(""); }}>HTML 편집</button></div> : <div className="worker-nav"><span>{role === "input" ? "책방 정보 입력" : "HTML 편집"}</span><button onClick={returnToVisitor}>로그아웃</button></div>}
      </header>

      {storageError && <div className="storage-alert" role="status"><strong>공용 저장소 연결을 확인해 주세요.</strong><span>{storageError}</span></div>}

      {role === "visitor" && <section className="visitor-page">
        <div className="visitor-hero"><span>JIGWANSEOGA LOCAL BOOKS</span><h1>{formatMonth(month)}<br />동네책방 소식</h1><a className="visitor-cta" href="https://jigwanseoga.org/133" target="_blank" rel="noreferrer">지관서가 동네책방 바로가기 ↗</a><div className="visitor-kpis"><strong>{publicEntries.length}<small>책방</small></strong><strong>{publicEntries.reduce((sum, item) => sum + item.submission.news.length, 0)}<small>소식</small></strong></div></div>
        <div className="visitor-content">
          <section className="mobile-calendar">
            <div className="calendar-head"><button type="button" aria-label="이전 달" onClick={() => { setMonth(shiftMonth(month, -1)); setSelectedDay(""); }}>← 이전 달</button><h2 aria-live="polite">{formatMonth(month)}</h2><button type="button" aria-label="다음 달" onClick={() => { setMonth(shiftMonth(month, 1)); setSelectedDay(""); }}>다음 달 →</button></div>
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
          </section>
          <div className="discovery-tools"><label><span className="sr-only">책방이나 소식 검색</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="책방이나 소식을 검색해 보세요" /></label></div>
          <div className="public-heading"><div><span>{selectedDay ? formatDate(selectedDay) : "이번 달"}</span><h2>{selectedDay ? "선택한 날짜의 소식" : "책방별 소식"}</h2></div><small>{filteredEntries.length}개 책방</small></div>
          <div className="public-feed">{filteredEntries.map(({ bookstore, submission }) => {
            const newsItems = selectedDay ? submission.news.filter((news) => news.dates.includes(selectedDay)) : submission.news;
            if (!newsItems.length) return null;
            return <article className="public-card" key={submission.id} style={{ borderTopColor: bookstoreColor(bookstore.id) }}><h3>{bookstore.name}</h3><ul className="public-event-list">{newsItems.map((news) => <li key={news.id}><button type="button" onClick={() => setPublicDetail({ submissionId: submission.id, newsId: news.id })}>{news.title}<span aria-hidden="true">›</span></button></li>)}</ul></article>;
          })}</div>
        </div>
      </section>}

      {role === "visitor" && publicDetailData && <PublicNewsDetail {...publicDetailData} onClose={() => setPublicDetail(null)} />}

      {role === "input" && <section className="input-area">
        <div className="input-flow-guide" aria-label="소식 입력 순서">
          <strong>① 발행 월 확인</strong><span aria-hidden="true">→</span><strong>② 소식 작성</strong><span aria-hidden="true">→</span><strong>③ 입력 마무리</strong>
        </div>

        {inputView === "list" && <>
          <div className="workspace-heading"><div><span>BOOKSTORE NEWS INPUT</span><h1>책방 소식 입력</h1><p>책방을 선택해 한 곳씩 작성하세요. 입력 내용은 자동으로 저장됩니다.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void copyText(completionShareMessage())} disabled={!monthSubmissions.some((item) => item.status === "completed")}>완료 내용 공유하기</button><button className="primary-button" onClick={() => setInputView("bookstores")}>책방 관리</button></div></div>
          <div className="input-month-summary">
            <div className="input-month-nav" aria-label="발행 월 선택">
              <button type="button" onClick={() => setMonth(shiftMonth(month, -1))}>← 이전 달</button>
              <div><span>발행 월</span><strong aria-live="polite">{formatMonth(month)}</strong></div>
              <button type="button" onClick={() => setMonth(shiftMonth(month, 1))}>다음 달 →</button>
            </div>
            <div className="work-progress-summary">
              <div><span>이번 달 작업 진행률</span><strong>{completedBookstoreCount}/{bookstores.length}곳 완료</strong></div>
              <div className="work-progress-track" role="progressbar" aria-label="이번 달 책방 입력 완료율" aria-valuemin={0} aria-valuemax={bookstores.length} aria-valuenow={completedBookstoreCount}><i style={{ width: `${completionPercent}%` }} /></div>
            </div>
          </div>
          {bookstores.length ? <div className="bookstore-work-list">{bookstores.map((bookstore) => { const submission = submissions.find((item) => item.bookstoreId === bookstore.id && item.month === month); const images = submission?.news.reduce((sum, news) => sum + news.images.length, 0) || 0; return <button key={bookstore.id} onClick={() => openBookstore(bookstore.id)}><div><span>{bookstore.region}</span><h2>{bookstore.name}</h2><p>{submission ? `소식 ${submission.news.length}건 · 사진 ${images}장` : "이번 달 소식 없음"}</p></div><div><span className={`work-status status-${submissionStatus(submission).replaceAll(" ", "-")}`}>{submissionStatus(submission)}</span><small>{submission ? formatSavedAt(submission.updatedAt) : "작성 시작하기"}</small></div></button>; })}</div> : <div className="empty-state input-empty-state"><h2>등록된 책방이 없습니다.</h2><p>책방 관리에서 첫 책방의 기본정보를 등록해 주세요.</p><button className="primary-button" onClick={() => setInputView("bookstores")}>책방 등록하기</button></div>}
        </>}

        {inputView === "bookstores" && <BookstoreManagement bookstores={bookstores} setBookstores={setBookstores} onBack={() => setInputView("list")} notify={notify} />}

        {inputView === "edit" && selectedBookstoreId && currentSubmission && (() => {
          const bookstore = bookstores.find((item) => item.id === selectedBookstoreId)!;
          return <div className="single-editor">
            <div className="editor-page-head">
              <button className="back-button" onClick={() => { setInputView("list"); setSelectedBookstoreId(null); }}>← 책방 목록</button>
              <div><span>{bookstore.region} · {formatMonth(month)}</span><h1>{bookstore.name}</h1><p>{saveState}</p></div>
              <button className="secondary-button" onClick={copyPrevious}>지난달 소식 불러오기</button>
            </div>

            <section className="monthly-notice-card">
              <div><span>MONTHLY NOTICE</span><h2>이번 달 운영 안내 <em>선택</em></h2><p>임시 휴무, 이전, 이번 달만 달라지는 영업시간이 있을 때만 적어주세요.</p></div>
              <textarea rows={3} value={currentSubmission.monthlyNotice} onChange={(event) => updateCurrent((submission) => ({ ...submission, monthlyNotice: event.target.value }))} placeholder="예: 7월 15일은 내부 일정으로 쉽니다." />
            </section>

            {currentSubmission.news.map((news, index) => <article className="news-editor-card" key={news.id} draggable onDragStart={() => setDraggedNewsId(news.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderNews(news.id)}>
              <div className="news-editor-head"><span className="drag-handle">⠿</span><div><small>소식 {index + 1}</small><h2>{news.title || "새 소식"}</h2></div><div className="reorder-buttons"><button onClick={() => moveNews(news.id, -1)} disabled={index === 0}>↑</button><button onClick={() => moveNews(news.id, 1)} disabled={index === currentSubmission.news.length - 1}>↓</button><button className="danger" onClick={() => updateCurrent((submission) => ({ ...submission, news: submission.news.filter((item) => item.id !== news.id) }))} disabled={currentSubmission.news.length === 1}>삭제</button></div></div>
              <div className="form-grid">
                <label className="wide"><span>소식 제목 *</span><input data-required-field="title" value={news.title} onChange={(event) => updateNews(news.id, "title", event.target.value)} placeholder="예: 7월 중국어 원서 독서모임" /></label>
                <label className="wide"><span>상세 내용 *</span><textarea data-required-field="description" rows={7} value={news.description} onChange={(event) => updateNews(news.id, "description", event.target.value)} placeholder="Word에 작성하던 것처럼 내용을 자연스럽게 적어주세요." /></label>
                <label className="wide"><span>행사 날짜 <em>달력에 표시할 날짜 · 여러 개 가능</em></span><div className="date-list">{news.dates.map((date) => <span key={date}>{formatDate(date)}<button onClick={() => updateNews(news.id, "dates", news.dates.filter((item) => item !== date))}>×</button></span>)}<input type="date" value="" onChange={(event) => { if (event.target.value && !news.dates.includes(event.target.value)) updateNews(news.id, "dates", [...news.dates, event.target.value].sort()); }} /></div></label>
                <label className="wide"><span>일정 안내 <em>선택</em></span><input value={news.scheduleText} onChange={(event) => updateNews(news.id, "scheduleText", event.target.value)} placeholder="예: 7월 3일(목) 오후 7시~9시 / 매월 첫째 목요일" /></label>
                <label className="check-label"><input type="checkbox" checked={news.regular} onChange={(event) => updateNews(news.id, "regular", event.target.checked)} /><span>정기적으로 진행하는 소식입니다</span></label>
                <label><span>신청 마감일 <em>선택</em></span><input type="date" value={news.deadline} onChange={(event) => updateNews(news.id, "deadline", event.target.value)} /></label>
                <label className="wide"><span>사진 <em>선택 · 여러 장 가능</em></span><div className="upload-box" onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files), news.id); }}><input type="file" accept="image/*" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { void addImages(Array.from(event.target.files || []), news.id); event.target.value = ""; }} /><strong>＋ 사진 첨부하기</strong><small>여러 사진을 이곳에 끌어다 놓아도 됩니다.</small></div></label>
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
            </article>)}

            <button className="add-news-button" onClick={() => updateCurrent((submission) => ({ ...submission, news: [...submission.news, makeNews()] }))}>＋ 소식 하나 더 추가</button>
            <div className="finish-bar"><div><strong>{bookstore.name} 소식 작성을 마치셨나요?</strong><small>{saveState}</small></div><div><button className="secondary-button" onClick={manualSave}>임시 저장</button><button className="primary-button" onClick={completeSubmission}>입력 마무리</button></div></div>
          </div>;
        })()}
      </section>}

      {role === "html" && <section className="html-workspace">
        <aside className="html-sidebar"><div><span>HTML WORKSPACE</span><h1>HTML 편집</h1></div><label><span>발행 월</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><nav><button className={htmlView === "individual" ? "active" : ""} onClick={() => setHtmlView("individual")}>개별 HTML <b>{htmlReady.length}</b></button><button className={htmlView === "digest" ? "active" : ""} onClick={() => setHtmlView("digest")}>통합본 만들기</button></nav>{htmlView === "individual" && <div className="ready-list">{htmlReady.map((submission) => { const bookstore = bookstores.find((item) => item.id === submission.bookstoreId); return <button className={selectedHtmlSubmission?.id === submission.id ? "selected" : ""} key={submission.id} onClick={() => setSelectedSubmissionId(submission.id)}><strong>{bookstore?.name}</strong><span>{submission.news.length}개 소식 · {submissionStatus(submission)}</span></button>; })}</div>}</aside>
        {htmlView === "individual" ? <div className="html-main">{selectedHtmlSubmission && selectedHtmlBookstore ? <><div className="html-main-head"><div><span>{formatMonth(month)} · {selectedHtmlBookstore.region}</span><h2>{selectedHtmlBookstore.name}</h2><p>입력 완료된 내용만 표시됩니다.</p></div><div><button className="secondary-button" onClick={() => void downloadPhotoZip(selectedHtmlSubmission, selectedHtmlBookstore, false)}>사진 ZIP</button><button className="primary-button" onClick={() => void downloadPhotoZip(selectedHtmlSubmission, selectedHtmlBookstore, true)}>HTML + 사진 ZIP</button></div></div><div className="html-tabs"><button className={previewMode === "preview" ? "active" : ""} onClick={() => setPreviewMode("preview")}>HTML 미리보기</button><button className={previewMode === "code" ? "active" : ""} onClick={() => setPreviewMode("code")}>HTML 코드</button><button onClick={() => navigator.clipboard.writeText(generatedCode).then(() => notify("HTML 코드를 복사했습니다."))}>HTML 복사</button></div><div className="html-preview">{previewMode === "preview" ? <iframe title={`${selectedHtmlBookstore.name} HTML 미리보기`} srcDoc={`<!doctype html><html><body style="margin:0;background:#eee;padding:24px">${generatedPreview}</body></html>`} /> : <pre>{generatedCode}</pre>}</div><PublishPanel key={selectedHtmlSubmission.id} submission={selectedHtmlSubmission} onPublish={updatePublished} /></> : <div className="empty-state"><h2>입력 완료된 책방이 없습니다.</h2><p>정보 입력자가 입력을 마치면 이곳에 표시됩니다.</p></div>}</div> : <div className="digest-work"><div className="digest-control"><div><span>DIGEST ORDER</span><h2>통합본 수록 순서</h2><p>책방과 포함할 소식을 선택하고 끌어서 순서를 바꿔보세요.</p></div>{htmlReady.map((submission, index) => { const bookstore = bookstores.find((item) => item.id === submission.bookstoreId); return <article key={submission.id} draggable onDragStart={() => setDraggedDigestId(submission.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderDigest(submission.id)}><header><span>⠿</span><div><strong>{index + 1}. {bookstore?.name}</strong><small>{bookstore?.region}</small></div></header>{submission.news.map((news) => <label key={news.id}><input type="checkbox" checked={news.includeInDigest} onChange={() => setSubmissions((current) => current.map((item) => item.id === submission.id ? { ...item, news: item.news.map((entry) => entry.id === news.id ? { ...entry, includeInDigest: !entry.includeInDigest } : entry) } : item))} /><span>{news.title}</span></label>)}</article>; })}</div><div className="digest-output"><div><span>통합 HTML 미리보기</span><button onClick={() => navigator.clipboard.writeText(combinedHtml).then(() => notify("통합 HTML을 복사했습니다."))}>HTML 복사</button></div><iframe title="통합 HTML 미리보기" srcDoc={`<!doctype html><html><body style="margin:0;background:#eee;padding:24px">${combinedHtml}</body></html>`} /></div></div>}
      </section>}

      {leaveTarget && <div className="modal-backdrop"><section className="leave-modal" role="dialog" aria-modal="true" aria-labelledby="leave-dialog-title"><span>WRITING IN PROGRESS</span><h2 id="leave-dialog-title">작성 중인 내용이 있습니다.</h2><p>입력 마무리 전인 소식입니다. 지금 나가도 내용은 임시 저장되지만 상태는 <strong>작성 중</strong>으로 유지됩니다.</p><div className="leave-modal-actions"><button className="secondary-button" onClick={() => setLeaveTarget(null)} autoFocus>계속 작성</button><button className="primary-button" onClick={confirmLeave}>임시 저장 후 나가기</button></div></section></div>}
      {accessRole && <div className="modal-backdrop" onMouseDown={() => { setAccessRole(null); setPassword(""); }}><section className="access-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => { setAccessRole(null); setPassword(""); }}>×</button><span>{accessRole === "input" ? "NEWS INPUT ACCESS" : "HTML EDITOR ACCESS"}</span><h2>{accessRole === "input" ? "소식 입력" : "HTML 편집"} 접속</h2><p>{accessRole === "input" ? "책방 소식을 작성하려면 입력자 암호를 입력해 주세요." : "완료된 소식을 HTML로 편집하려면 편집자 암호를 입력해 주세요."}</p><label><span>작업 암호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && login()} autoFocus /></label><button className="primary-button" onClick={login}>{accessRole === "input" ? "소식 입력으로 이동" : "HTML 편집으로 이동"}</button><small>한글·영문 자판 어느 쪽으로 입력해도 됩니다. 접속 상태는 이 탭을 닫거나 로그아웃할 때까지 유지됩니다.</small></section></div>}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}

function BookstoreManagement({ bookstores, setBookstores, onBack, notify }: { bookstores: Bookstore[]; setBookstores: React.Dispatch<React.SetStateAction<Bookstore[]>>; onBack: () => void; notify: (message: string) => void }) {
  const [form, setForm] = useState<Bookstore>(blankBookstore());
  const [editingId, setEditingId] = useState<number | null>(null);
  const edit = (bookstore?: Bookstore) => { setForm(bookstore ? { ...bookstore } : blankBookstore()); setEditingId(bookstore?.id ?? null); };
  const save = () => {
    if (!form.name.trim() || !form.region.trim()) { notify("책방 이름과 지역을 입력해 주세요."); return; }
    setBookstores((current) => editingId === null ? [...current, form] : current.map((item) => item.id === editingId ? form : item));
    edit();
    notify(editingId === null ? "새 책방을 저장했습니다." : "책방 정보를 수정했습니다.");
  };
  const field = (key: Exclude<keyof Bookstore, "id" | "contacts" | "links">, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="bookstore-management">
    <div className="workspace-heading"><div><button className="back-button" onClick={onBack}>← 뒤로가기</button><h1>책방 관리</h1><p>한 번 저장한 기본정보는 매월 소식 작성에 다시 사용됩니다.</p></div><button className="primary-button" onClick={() => edit()}>＋ 새 책방</button></div>
    <div className="management-grid">
      <div className="management-list">{bookstores.map((bookstore) => <button className={editingId === bookstore.id ? "active" : ""} key={bookstore.id} onClick={() => edit(bookstore)}><strong>{bookstore.name}</strong><span>{bookstore.region}</span><small>{bookstore.address || "주소 미등록"}</small></button>)}</div>
      <div className="management-form"><h2>{editingId === null ? "새 책방 등록" : "책방 정보 수정"}</h2>
        <div className="form-grid">
          <label><span>책방 이름 *</span><input value={form.name} onChange={(event) => field("name", event.target.value)} /></label>
          <label><span>지역 *</span><input value={form.region} onChange={(event) => field("region", event.target.value)} placeholder="예: 울산 남구" /></label>
          <label className="wide"><span>주소</span><input value={form.address} onChange={(event) => field("address", event.target.value)} /></label>
          <label className="wide"><span>책방 소개</span><textarea rows={3} value={form.introduction} onChange={(event) => field("introduction", event.target.value)} /></label>
          <label><span>영업시간</span><input value={form.hours} onChange={(event) => field("hours", event.target.value)} /></label>
          <label><span>대표 연락처</span><input value={form.phone} onChange={(event) => field("phone", event.target.value)} /></label>
          <label><span>대표 SNS</span><input value={form.sns} onChange={(event) => field("sns", event.target.value)} placeholder="https://instagram.com/..." /></label>
          <label><span>홈페이지</span><input value={form.website} onChange={(event) => field("website", event.target.value)} placeholder="https://..." /></label>
        </div>
        <div className="repeatable-section"><div><strong>추가 연락처</strong><small>책방지기 연락처처럼 대표 연락처와 구분할 정보가 있을 때 사용합니다.</small></div>{(form.contacts || []).map((contact) => <div className="repeatable-row" key={contact.id}><input value={contact.label} onChange={(event) => setForm((current) => ({ ...current, contacts: current.contacts.map((item) => item.id === contact.id ? { ...item, label: event.target.value } : item) }))} placeholder="연락처 이름" /><input value={contact.value} onChange={(event) => setForm((current) => ({ ...current, contacts: current.contacts.map((item) => item.id === contact.id ? { ...item, value: event.target.value } : item) }))} placeholder="전화번호 또는 안내" /><button onClick={() => setForm((current) => ({ ...current, contacts: current.contacts.filter((item) => item.id !== contact.id) }))}>삭제</button></div>)}<button className="text-add-button" onClick={() => setForm((current) => ({ ...current, contacts: [...(current.contacts || []), makeValue()] }))}>＋ 연락처 추가</button></div>
        <div className="repeatable-section"><div><strong>추가 링크</strong><small>블로그, 두 번째 SNS 등 여러 주소를 등록할 수 있습니다.</small></div>{(form.links || []).map((link) => <div className="repeatable-row" key={link.id}><input value={link.label} onChange={(event) => setForm((current) => ({ ...current, links: current.links.map((item) => item.id === link.id ? { ...item, label: event.target.value } : item) }))} placeholder="링크 이름" /><input value={link.url} onChange={(event) => setForm((current) => ({ ...current, links: current.links.map((item) => item.id === link.id ? { ...item, url: event.target.value } : item) }))} placeholder="https://..." /><button onClick={() => setForm((current) => ({ ...current, links: current.links.filter((item) => item.id !== link.id) }))}>삭제</button></div>)}<button className="text-add-button" onClick={() => setForm((current) => ({ ...current, links: [...(current.links || []), makeLink()] }))}>＋ 링크 추가</button></div>
        <div className="form-actions"><button className="secondary-button" onClick={() => edit()}>취소</button><button className="primary-button" onClick={save}>저장</button></div>
      </div>
    </div>
  </div>;
}

function PublicNewsDetail({ submission, news, bookstore, onClose }: { submission: Submission; news: NewsItem; bookstore: Bookstore; onClose: () => void }) {
  const status = submissionStatus(submission);
  const links = [
    news.applyUrl ? { id: -1, label: "신청 및 자세히 보기", url: news.applyUrl } : null,
    ...news.links,
  ].filter((item): item is LabeledLink => Boolean(item && safeClientHref(item.url)));
  return <div className="public-detail-backdrop" onMouseDown={onClose}>
    <article className="public-detail" role="dialog" aria-modal="true" aria-labelledby="public-detail-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="public-detail-close" onClick={onClose} aria-label="상세 소식 닫기">×</button>
      <header><span>{bookstore.region} · {formatMonth(submission.month)}</span><h2 id="public-detail-title">{news.title}</h2><div className="public-detail-badges"><i>{status}</i>{news.regular && <i>정기</i>}{news.displayLabel && <i>{news.displayLabel}</i>}</div></header>
      {news.images.length > 0 && <div className="public-detail-photos">{news.images.map((image) => <figure key={image.id}><img src={image.url} alt={image.caption || news.title} loading="lazy" />{image.caption && <figcaption>{image.caption}</figcaption>}</figure>)}</div>}
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

function PublishPanel({ submission, onPublish }: { submission: Submission; onPublish: (url: string) => void }) {
  const [url, setUrl] = useState(submission.publishedUrl);
  return <section className="publish-panel"><div><strong>{submission.publishedAt ? "게시 상태를 업데이트하시나요?" : "외부 게시판 게시를 마치셨나요?"}</strong><small>게시 URL은 선택사항이며 방문자 화면의 바로가기에 사용됩니다.</small></div><label><span className="sr-only">게시 URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="게시 URL (선택)" /></label><button className="primary-button" onClick={() => onPublish(url)}>{submission.publishedAt ? "재게시 완료" : "게시 완료"}</button></section>;
}
