"use client";

import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { digestHtml, generatedHtml } from "@/lib/html-generators";
import {
  BOOKSTORE_COLORS,
  INITIAL_MONTH,
  formatMonth,
  hasSubmissionContent,
  makeSubmission,
  nowIso,
  previousMonth,
  safeFilename,
  type LeaveTarget,
  type Role,
} from "@/lib/workspace-formatters";
import {
  createImagePreview,
  loadWorkspace,
  MAX_ORIGINAL_IMAGE_BYTES,
  persistWorkspace,
  persistWorkspaceOnUnload,
  reserveImageUpload,
  responseMessage,
  triggerDownload,
  uploadFileToSignedUrl,
  urlToBlob,
  workspaceSessionHeaders,
} from "@/lib/workspace-client";
import type { Bookstore, NewsImage, NewsItem, Submission, WorkStatus } from "@/lib/workspace-types";

/**
 * 세 역할이 공유하는 상태와 업무 명령을 한곳에서 조정하는 application controller입니다.
 * 컴포넌트는 이 반환값만 사용하고 저장소·세션·HTML 생성 구현을 직접 알지 않습니다.
 */
export function useStudioController() {
  // 화면 선택, 편집 대상, 드래그 상태처럼 브라우저 탭 안에서만 필요한 UI 상태입니다.
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

  // 첫 진입 시 서버가 검증한 작업자 세션을 복원하고 공용 Workspace를 불러옵니다.
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

  // 입력자·편집자의 변경을 1.2초 동안 모아 저장해 입력마다 API를 호출하지 않게 합니다.
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

  // 방문자 검색은 타이핑이 잠시 멈춘 뒤 계산해 모바일 렌더링 부담을 줄입니다.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // 원본 상태에서 현재 역할과 선택값에 필요한 화면 데이터만 파생합니다.
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

  // 작성 중 이탈은 브라우저 종료와 앱 내부 이동을 모두 가로채 임시 저장 기회를 줍니다.
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

  // 작업 암호는 서버로만 보내며 성공하면 현재 탭의 임의 sessionId와 HttpOnly 쿠키를 함께 사용합니다.
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

  // 책방을 처음 열 때 해당 월의 빈 Submission을 만들고 이후에는 같은 레코드를 재사용합니다.
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

  // 모든 소식 수정은 이 함수를 통과합니다. 완료본을 수정하면 draft로 돌리고 제거된 사진도 정리합니다.
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

  // 미리보기는 브라우저에서 축소하고, 큰 원본은 GPT 임시 서버를 거치지 않고 Storage로 바로 올립니다.
  const addImages = async (files: File[], newsId: number) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) { notify("이미지 파일만 첨부할 수 있습니다."); return; }
    if (!selectedBookstoreId) return;
    const uploaded: NewsImage[] = [];
    const reserved: NewsImage[] = [];
    try {
      setSaveState(`사진 ${images.length}장 업로드 중...`);
      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        setSaveState(`사진 ${index + 1}/${images.length} 업로드 중...`);
        if (file.size > MAX_ORIGINAL_IMAGE_BYTES) throw new Error(`${file.name}: 사진 한 장은 20MB 이하로 업로드해 주세요.`);
        const preview = await createImagePreview(file);
        const reservation = await reserveImageUpload(file, preview, month, selectedBookstoreId, newsId);
        reserved.push(reservation.image);
        await uploadFileToSignedUrl(reservation.uploads.originalUrl, file, "300");
        await uploadFileToSignedUrl(reservation.uploads.previewUrl, preview, "300");
        uploaded.push(reservation.image);
      }
      updateCurrent((submission) => ({ ...submission, news: submission.news.map((news) => news.id === newsId ? { ...news, images: [...news.images, ...uploaded] } : news) }));
      setStorageError("");
      setSaveState("사진 업로드 완료 · 내용 저장 중...");
      notify(`사진 ${uploaded.length}장을 저장했습니다.`);
    } catch (error) {
      reserved.forEach(deleteStoredImage);
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

  // 소식과 사진의 정렬 결과는 배열 순서 자체에 저장되어 HTML과 방문자 화면에 동일하게 반영됩니다.
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

  // 지난달 복사는 본문 구조만 재사용하고, 일정·신청·사진처럼 월마다 달라지는 값은 초기화합니다.
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

  // 필수값을 확인한 뒤 completed로 바꿉니다. 이후 수정은 updateCurrent가 다시 draft로 전환합니다.
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

  // HTML 편집자가 외부 게시판에 올릴 수 있도록 비공개 원본 사진과 선택적 HTML을 ZIP으로 묶습니다.
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

  // 통합본 순서는 해당 월의 완료 Submission 구간 안에서만 바꿉니다.
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

  // 달력 칸과 책방별 색상은 저장하지 않고 현재 월·책방 순서에서 매번 계산합니다.
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

  // 아래 객체가 UI 계층에 공개되는 controller API입니다. 서버 구현은 여기 밖으로 노출하지 않습니다.
  return {
    role, accessRole, password, bookstores, submissions, month, selectedBookstoreId, inputView,
    selectedSubmissionId, htmlView, previewMode, search, selectedDay, toast, saveState,
    draggedNewsId, draggedImageId, draggedDigestId, publicDetail, leaveTarget, storageError,
    currentSubmission, htmlReady, selectedHtmlSubmission, selectedHtmlBookstore, generatedCode,
    generatedPreview, combinedHtml, monthSubmissions, completedBookstoreCount, completionPercent,
    publicEntries, filteredEntries, publicDetailData, calendarDays,
    setAccessRole, setPassword, setBookstores, setSubmissions, setMonth, setSelectedBookstoreId,
    setInputView, setSelectedSubmissionId, setHtmlView, setPreviewMode, setSearch, setSelectedDay,
    setDraggedNewsId, setDraggedImageId, setDraggedDigestId, setPublicDetail, setLeaveTarget,
    login, returnToVisitor, confirmLeave, openBookstore, updateCurrent, updateNews, updateNewsValue,
    addImages, reorderNews, moveNews, reorderImages, moveImage, copyPrevious, manualSave,
    completeSubmission, completionShareMessage, copyText, downloadPhotoZip, reorderDigest,
    updatePublished, bookstoreColor, calendarItems, notify,
  };
}

export type StudioController = ReturnType<typeof useStudioController>;
