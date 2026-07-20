"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

type Status = "작성 중" | "검토 요청" | "수정 요청" | "승인";

type NewsItem = {
  id: number;
  title: string;
  category: string;
  status: string;
  startDate: string;
  endDate: string;
  place: string;
  fee: string;
  description: string;
  summary: string;
  applyUrl: string;
  imageName: string;
  imageUrl: string;
  includeInDigest: boolean;
};

type Submission = {
  id: number;
  bookstore: string;
  region: string;
  address: string;
  hours: string;
  phone: string;
  sns: string;
  month: string;
  writer: string;
  status: Status;
  updatedAt: string;
  revisionNote: string;
  news: NewsItem[];
};

const seedSubmissions: Submission[] = [
  {
    id: 1,
    bookstore: "소담쓰담",
    region: "울산 남구",
    address: "울산 남구 삼호로 25",
    hours: "화~일 12:00~18:00 / 월요일 휴무",
    phone: "0507-1339-3685",
    sns: "@minxi1228",
    month: "2026-07",
    writer: "김소담",
    status: "검토 요청",
    updatedAt: "7월 18일 14:20",
    revisionNote: "",
    news: [
      {
        id: 11,
        title: "상반기 문학 독서모임 마무리",
        category: "독서모임",
        status: "종료",
        startDate: "2026-06-25",
        endDate: "",
        place: "소담쓰담",
        fee: "",
        description: "앨리스 먼로의 『거지 소녀』를 마지막으로 상반기 문학모임을 잘 마무리했습니다. 7~8월 휴식 후 9월부터 하반기 모임을 시작합니다.",
        summary: "테마 ‘작은 빛’과 함께한 상반기 문학 독서모임 마무리",
        applyUrl: "",
        imageName: "문학모임.jpg",
        imageUrl: "",
        includeInDigest: true,
      },
      {
        id: 12,
        title: "7월 중국어 원서 독서모임",
        category: "독서모임",
        status: "모집 중",
        startDate: "2026-09-05",
        endDate: "",
        place: "Zoom 온라인",
        fee: "",
        description: "모옌의 《강풍에도 쓰러지지 않는다》를 7~8월 두 달에 걸쳐 읽습니다. 매월 한 번 Zoom으로 진행하며 새로운 멤버를 환영합니다.",
        summary: "모옌의 원서를 함께 읽는 온라인 중국어 독서모임, 신규 멤버 환영",
        applyUrl: "https://instagram.com/minxi1228",
        imageName: "중국어모임.jpg",
        imageUrl: "",
        includeInDigest: true,
      },
    ],
  },
  {
    id: 2,
    bookstore: "수연목서",
    region: "경기 여주시",
    address: "경기도 여주시 산북면 주어로 58",
    hours: "수~일 운영 / 월·화 휴무",
    phone: "031-885-5958",
    sns: "@suyonmokseo",
    month: "2026-07",
    writer: "최수연",
    status: "승인",
    updatedAt: "7월 17일 09:10",
    revisionNote: "",
    news: [
      {
        id: 21,
        title: "김우영 작가 사진전 《AFTER USE》",
        category: "전시",
        status: "진행 중",
        startDate: "2026-06-13",
        endDate: "2026-08-16",
        place: "수연목서 갤러리",
        fee: "무료",
        description: "쓰임을 다한 건축물과 구조물의 표면에 남겨진 시간의 흔적을 바라보는 사진전입니다.",
        summary: "기능을 다한 건축물에 남은 시간의 흔적을 담은 김우영 작가 사진전",
        applyUrl: "https://www.suyonmokseo.com",
        imageName: "after-use.jpg",
        imageUrl: "",
        includeInDigest: true,
      },
    ],
  },
  {
    id: 3,
    bookstore: "오직 책방",
    region: "경기 여주시",
    address: "경기 여주시 세종로 254-6",
    hours: "화~일 13:00~21:00 / 월요일 휴무",
    phone: "031-886-5567",
    sns: "@ojik_books",
    month: "2026-07",
    writer: "조중재",
    status: "수정 요청",
    updatedAt: "7월 18일 11:35",
    revisionNote: "대표 이미지가 흐립니다. 원본 이미지를 다시 올려주세요.",
    news: [
      {
        id: 31,
        title: "온라인 일요일 읽기모임",
        category: "독서모임",
        status: "모집 중",
        startDate: "2026-08-02",
        endDate: "",
        place: "네이버 웨일 온라인",
        fee: "5만원",
        description: "혼자 완독하기 힘든 벽돌책을 매주 일요일 온라인에서 함께 읽는 10주 프로그램입니다.",
        summary: "매주 일요일 저녁, 두꺼운 책을 함께 완독하는 10주 온라인 읽기모임",
        applyUrl: "https://naver.me/5RAYReWM",
        imageName: "일요일읽기모임.jpg",
        imageUrl: "",
        includeInDigest: true,
      },
    ],
  },
];

const emptyNews = (id = Date.now()): NewsItem => ({
  id,
  title: "",
  category: "행사",
  status: "진행 예정",
  startDate: "",
  endDate: "",
  place: "",
  fee: "",
  description: "",
  summary: "",
  applyUrl: "",
  imageName: "",
  imageUrl: "",
  includeInDigest: true,
});

const emptySubmission = (): Submission => ({
  id: Date.now(),
  bookstore: "",
  region: "",
  address: "",
  hours: "",
  phone: "",
  sns: "",
  month: "2026-07",
  writer: "",
  status: "작성 중",
  updatedAt: "방금 전",
  revisionNote: "",
  news: [emptyNews()],
});

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const monthLabel = (month: string) => {
  const [year, numericMonth] = month.split("-");
  return `${year}년 ${Number(numericMonth)}월`;
};

function individualHtml(submission: Submission) {
  const sections = submission.news
    .map((item) => {
      const dates = [item.startDate, item.endDate].filter(Boolean).join(" ~ ");
      return `
  <section style="margin:32px 0;">
    <h2 style="color:#2f4538; font-size:1.5em; margin:0 0 14px; font-weight:bold;">${escapeHtml(item.title)}</h2>
    <div style="background:#f7f4ed; border-radius:14px; padding:20px; border:1px solid #e8e1d3;">
      <p style="margin:0 0 12px; line-height:1.75; color:#333;">${escapeHtml(item.description)}</p>
      ${dates ? `<p style="margin:6px 0;"><strong>일정:</strong> ${escapeHtml(dates)}</p>` : ""}
      ${item.place ? `<p style="margin:6px 0;"><strong>장소:</strong> ${escapeHtml(item.place)}</p>` : ""}
      ${item.fee ? `<p style="margin:6px 0;"><strong>참가비:</strong> ${escapeHtml(item.fee)}</p>` : ""}
      ${item.applyUrl ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(item.applyUrl)}" style="color:#9a5b36; font-weight:bold;">신청 및 자세히 보기</a></p>` : ""}
    </div>
  </section>`;
    })
    .join("\n");

  return `<div style="max-width:800px; margin:0 auto; background:white; padding:28px; font-family:'Apple SD Gothic Neo',Arial,sans-serif; line-height:1.6; color:#26312b;">
  <h1 style="text-align:center; color:#2f4538; font-size:1.8em; margin:0 0 24px;">지관서가 전해주는 ${monthLabel(submission.month)} 소식 – ${escapeHtml(submission.bookstore)}</h1>
  <div style="background:#eef2eb; border-left:4px solid #6f8a74; padding:16px 18px; margin-bottom:24px;">
    <p style="margin:0;"><strong>${escapeHtml(submission.bookstore)}</strong><br>
    주소: ${escapeHtml(submission.address)}<br>
    영업시간: ${escapeHtml(submission.hours)}<br>
    연락처: ${escapeHtml(submission.phone)}<br>
    SNS: ${escapeHtml(submission.sns)}</p>
  </div>
  ${sections}
</div>`;
}

function digestHtml(submissions: Submission[]) {
  const blocks = submissions
    .filter((submission) => submission.status === "승인")
    .map((submission) => {
      const items = submission.news
        .filter((item) => item.includeInDigest)
        .map(
          (item) =>
            `<li style="margin:8px 0;"><strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.summary || item.description)}</li>`,
        )
        .join("\n");
      if (!items) return "";
      return `<section style="margin:0 0 28px;">
    <h2 style="color:#8a5f42; font-size:1.35em; margin:0 0 8px;">${escapeHtml(submission.bookstore)} <span style="font-size:.7em; color:#7b817d;">(${escapeHtml(submission.region)})</span></h2>
    <ul style="margin:0; padding-left:22px;">${items}</ul>
  </section>`;
    })
    .join("\n");

  const month = submissions[0]?.month || "2026-07";
  return `<div style="max-width:900px; margin:0 auto; background:#fff; padding:32px; font-family:'Apple SD Gothic Neo',Arial,sans-serif; line-height:1.65; color:#26312b;">
  <h1 style="text-align:center; font-size:1.9em; color:#2f4538; margin:0 0 32px;">지관서가 전해주는 동네 책방 ${monthLabel(month)} 소식</h1>
  ${blocks || '<p style="text-align:center; color:#777;">승인된 소식을 선택해 주세요.</p>'}
  <p style="margin-top:40px; text-align:center; color:#7b817d; font-size:.9em;">지관서가는 매월 전국의 동네 책방 소식을 전해드립니다.</p>
</div>`;
}

function downloadHtml(filename: string, html: string) {
  const blob = new Blob([`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${filename}</title></head><body style="margin:0;background:#f2f0eb;padding:24px;">${html}</body></html>`], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [role, setRole] = useState<"writer" | "editor">("writer");
  const [submissions, setSubmissions] = useState<Submission[]>(seedSubmissions);
  const [draft, setDraft] = useState<Submission>(emptySubmission());
  const [selectedId, setSelectedId] = useState(seedSubmissions[0].id);
  const [editorView, setEditorView] = useState<"queue" | "digest">("queue");
  const [previewMode, setPreviewMode] = useState<"visual" | "code">("visual");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const selected = submissions.find((item) => item.id === selectedId) || submissions[0];
  const selectedHtml = selected ? individualHtml(selected) : "";
  const combinedHtml = useMemo(() => digestHtml(submissions), [submissions]);
  const completedCount = submissions.filter((item) => item.status === "승인").length;

  useEffect(() => {
    const savedSubmissions = window.localStorage.getItem("bookstore-news-submissions");
    const savedDraft = window.localStorage.getItem("bookstore-news-draft");
    if (savedSubmissions) setSubmissions(JSON.parse(savedSubmissions) as Submission[]);
    if (savedDraft) setDraft(JSON.parse(savedDraft) as Submission);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("bookstore-news-submissions", JSON.stringify(submissions));
  }, [hydrated, submissions]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("bookstore-news-draft", JSON.stringify(draft));
  }, [draft, hydrated]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const updateDraft = (key: keyof Submission, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateNews = (id: number, key: keyof NewsItem, value: string | boolean) => {
    setDraft((current) => ({
      ...current,
      news: current.news.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    }));
  };

  const handleImage = (event: ChangeEvent<HTMLInputElement>, id: number) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateNews(id, "imageName", file.name);
      updateNews(id, "imageUrl", String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const submitDraft = () => {
    if (!draft.bookstore || !draft.writer || draft.news.some((item) => !item.title || !item.description || !item.summary)) {
      notify("필수 항목을 확인해 주세요.");
      return;
    }
    const next = { ...draft, status: "검토 요청" as Status, updatedAt: "방금 전" };
    setSubmissions((current) => [next, ...current]);
    setSelectedId(next.id);
    setDraft(emptySubmission());
    notify("검토 요청을 보냈습니다.");
  };

  const changeSubmissionStatus = (status: Status, note = "") => {
    setSubmissions((current) =>
      current.map((item) => (item.id === selectedId ? { ...item, status, revisionNote: note } : item)),
    );
    notify(status === "승인" ? "발행 가능한 상태로 승인했습니다." : "작성자에게 수정 요청을 보냈습니다.");
  };

  const toggleDigest = (submissionId: number, newsId: number) => {
    setSubmissions((current) =>
      current.map((submission) =>
        submission.id !== submissionId
          ? submission
          : {
              ...submission,
              news: submission.news.map((item) =>
                item.id === newsId ? { ...item, includeInDigest: !item.includeInDigest } : item,
              ),
            },
      ),
    );
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="책방소식 홈">
          <span className="brand-mark">책</span>
          <div><strong>책방소식</strong><small>동네 책방 소식 발행 도구</small></div>
        </div>
        <nav className="role-switch" aria-label="사용자 역할 선택">
          <button className={role === "writer" ? "active" : ""} onClick={() => setRole("writer")}>소식 작성</button>
          <button className={role === "editor" ? "active" : ""} onClick={() => setRole("editor")}>발행 관리</button>
        </nav>
        <div className="profile"><span>2026년 7월호</span><div className="avatar">지</div></div>
      </header>

      {role === "writer" ? (
        <div className="writer-layout">
          <aside className="writer-aside">
            <div className="eyebrow">소식 작성자</div>
            <h1>책방의 이번 달 이야기를 들려주세요.</h1>
            <p>HTML을 몰라도 괜찮아요. 항목에 맞게 작성하면 발행 담당자가 예쁘게 정리합니다.</p>
            <ol className="steps">
              <li className="done"><span>1</span><div><strong>책방 정보</strong><small>기본 연락처와 운영 정보</small></div></li>
              <li className="current"><span>2</span><div><strong>소식 등록</strong><small>행사, 모임, 전시를 자유롭게</small></div></li>
              <li><span>3</span><div><strong>검토 요청</strong><small>발행 담당자에게 전달</small></div></li>
            </ol>
            <div className="aside-note"><strong>작성 팁</strong><p>통합본용 한 줄 요약은 60자 안으로 핵심만 적어주세요.</p></div>
          </aside>

          <section className="form-page">
            <div className="page-heading">
              <div><span className="eyebrow">2026년 7월호</span><h2>소식 접수</h2><p>필수 항목은 <b>*</b>로 표시되어 있습니다.</p></div>
              <button className="ghost-button" onClick={() => notify("임시 저장했습니다.")}>임시 저장</button>
            </div>

            {draft.revisionNote && <div className="revision-banner"><strong>수정 요청</strong>{draft.revisionNote}</div>}

            <div className="form-card">
              <div className="section-title"><span>01</span><div><h3>책방 기본 정보</h3><p>소식 상단에 공통으로 표시됩니다.</p></div></div>
              <div className="field-grid two">
                <label><span>책방 이름 *</span><input value={draft.bookstore} onChange={(e) => updateDraft("bookstore", e.target.value)} placeholder="예: 소담쓰담" /></label>
                <label><span>작성자 이름 *</span><input value={draft.writer} onChange={(e) => updateDraft("writer", e.target.value)} placeholder="예: 김소담" /></label>
                <label><span>지역 *</span><input value={draft.region} onChange={(e) => updateDraft("region", e.target.value)} placeholder="예: 울산 남구" /></label>
                <label><span>발행 월</span><input type="month" value={draft.month} onChange={(e) => updateDraft("month", e.target.value)} /></label>
                <label className="wide"><span>주소</span><input value={draft.address} onChange={(e) => updateDraft("address", e.target.value)} placeholder="책방 주소를 입력해 주세요" /></label>
                <label><span>영업시간</span><input value={draft.hours} onChange={(e) => updateDraft("hours", e.target.value)} placeholder="화~일 12:00~18:00" /></label>
                <label><span>연락처</span><input value={draft.phone} onChange={(e) => updateDraft("phone", e.target.value)} placeholder="052-000-0000" /></label>
                <label className="wide"><span>SNS 또는 홈페이지</span><input value={draft.sns} onChange={(e) => updateDraft("sns", e.target.value)} placeholder="@bookstore 또는 https://..." /></label>
              </div>
            </div>

            {draft.news.map((item, index) => (
              <div className="form-card news-card" key={item.id}>
                <div className="section-title">
                  <span>{String(index + 2).padStart(2, "0")}</span>
                  <div><h3>소식 {index + 1}</h3><p>행사, 전시, 모임 등 한 가지 소식을 작성합니다.</p></div>
                  {draft.news.length > 1 && <button className="text-button danger" onClick={() => setDraft((current) => ({ ...current, news: current.news.filter((news) => news.id !== item.id) }))}>삭제</button>}
                </div>
                <div className="field-grid two">
                  <label className="wide"><span>소식 제목 *</span><input value={item.title} onChange={(e) => updateNews(item.id, "title", e.target.value)} placeholder="예: 7월 중국어 원서 독서모임" /></label>
                  <label><span>분류</span><select value={item.category} onChange={(e) => updateNews(item.id, "category", e.target.value)}><option>행사</option><option>독서모임</option><option>전시</option><option>모집</option><option>책방 소식</option></select></label>
                  <label><span>진행 상태</span><select value={item.status} onChange={(e) => updateNews(item.id, "status", e.target.value)}><option>진행 예정</option><option>모집 중</option><option>진행 중</option><option>종료</option><option>상시 운영</option></select></label>
                  <label><span>시작일</span><input type="date" value={item.startDate} onChange={(e) => updateNews(item.id, "startDate", e.target.value)} /></label>
                  <label><span>종료일</span><input type="date" value={item.endDate} onChange={(e) => updateNews(item.id, "endDate", e.target.value)} /></label>
                  <label><span>장소</span><input value={item.place} onChange={(e) => updateNews(item.id, "place", e.target.value)} placeholder="예: 책방 또는 Zoom" /></label>
                  <label><span>참가비</span><input value={item.fee} onChange={(e) => updateNews(item.id, "fee", e.target.value)} placeholder="예: 무료 / 1만원" /></label>
                  <label className="wide"><span>상세 내용 *</span><textarea rows={5} value={item.description} onChange={(e) => updateNews(item.id, "description", e.target.value)} placeholder="소식의 배경과 참여 방법을 자세히 적어주세요." /></label>
                  <label className="wide"><span>통합본용 한 줄 요약 *</span><div className="counter-wrap"><input maxLength={80} value={item.summary} onChange={(e) => updateNews(item.id, "summary", e.target.value)} placeholder="이 소식의 핵심을 한 문장으로 적어주세요." /><small>{item.summary.length}/80</small></div></label>
                  <label className="wide"><span>신청 링크</span><input value={item.applyUrl} onChange={(e) => updateNews(item.id, "applyUrl", e.target.value)} placeholder="https://..." /></label>
                  <label className="wide"><span>대표 이미지</span><div className="upload-box"><input type="file" accept="image/*" onChange={(e) => handleImage(e, item.id)} />{item.imageUrl ? <img src={item.imageUrl} alt="업로드 미리보기" /> : <><b>이미지를 끌어놓거나 눌러서 선택</b><small>JPG, PNG · 최대 10MB 권장</small></>}</div></label>
                </div>
              </div>
            ))}

            <button className="add-news" onClick={() => setDraft((current) => ({ ...current, news: [...current.news, emptyNews()] }))}><span>＋</span> 소식 하나 더 추가</button>
            <div className="submit-bar"><div><strong>작성을 마치셨나요?</strong><small>제출 후에도 수정 요청을 받아 다시 편집할 수 있습니다.</small></div><button className="primary-button" onClick={submitDraft}>검토 요청 보내기 <span>→</span></button></div>
          </section>
        </div>
      ) : (
        <div className="editor-layout">
          <aside className="editor-sidebar">
            <div className="sidebar-title"><span className="brand-mark small">책</span><strong>발행 관리</strong></div>
            <button className={editorView === "queue" ? "sidebar-link active" : "sidebar-link"} onClick={() => setEditorView("queue")}><span>▦</span> 접수함 <b>{submissions.length}</b></button>
            <button className={editorView === "digest" ? "sidebar-link active" : "sidebar-link"} onClick={() => setEditorView("digest")}><span>☷</span> 통합본 만들기 <b>{completedCount}</b></button>
            <div className="sidebar-section">발행 현황</div>
            <div className="progress-card"><div><strong>{completedCount}/{submissions.length}</strong><span>책방 승인</span></div><div className="progress-track"><i style={{ width: `${(completedCount / submissions.length) * 100}%` }} /></div><small>2026년 7월호</small></div>
            <div className="sidebar-bottom"><span>도움말</span><span>템플릿 설정</span></div>
          </aside>

          {editorView === "queue" ? (
            <>
              <section className="submission-list">
                <div className="list-heading"><div><span className="eyebrow">2026년 7월호</span><h1>소식 접수함</h1></div><button className="icon-button" aria-label="검색">⌕</button></div>
                <div className="filter-row"><button className="active">전체 {submissions.length}</button><button>검토 필요 {submissions.filter((s) => s.status === "검토 요청").length}</button><button>수정 요청</button></div>
                <div className="submission-cards">
                  {submissions.map((submission) => (
                    <button key={submission.id} className={selectedId === submission.id ? "submission-item selected" : "submission-item"} onClick={() => setSelectedId(submission.id)}>
                      <div className="submission-top"><span className={`status-badge status-${submission.status.replaceAll(" ", "")}`}>{submission.status}</span><small>{submission.updatedAt}</small></div>
                      <strong>{submission.bookstore}</strong><span>{submission.region} · 소식 {submission.news.length}개</span>
                      {submission.revisionNote && <em>{submission.revisionNote}</em>}
                    </button>
                  ))}
                </div>
              </section>

              <section className="review-pane">
                {selected && <>
                  <div className="review-header"><div><span className={`status-badge status-${selected.status.replaceAll(" ", "")}`}>{selected.status}</span><h2>{selected.bookstore}</h2><p>{selected.writer} 작성 · {selected.updatedAt}</p></div><div className="review-actions"><button className="ghost-button" onClick={() => changeSubmissionStatus("수정 요청", "내용을 한 번 더 확인해 주세요.")}>수정 요청</button><button className="primary-button" onClick={() => changeSubmissionStatus("승인")}>승인하기</button></div></div>
                  <div className="review-tabs"><button className={previewMode === "visual" ? "active" : ""} onClick={() => setPreviewMode("visual")}>미리보기</button><button className={previewMode === "code" ? "active" : ""} onClick={() => setPreviewMode("code")}>HTML 코드</button><button onClick={() => downloadHtml(`${selected.bookstore}-${selected.month}`, selectedHtml)}>HTML 다운로드 ↓</button></div>
                  <div className="preview-stage">
                    {previewMode === "visual" ? <iframe title={`${selected.bookstore} HTML 미리보기`} srcDoc={`<!doctype html><html><body style="margin:0;background:#f3f1ec;padding:24px;">${selectedHtml}</body></html>`} /> : <pre className="code-preview">{selectedHtml}</pre>}
                  </div>
                </>}
              </section>
            </>
          ) : (
            <section className="digest-page">
              <div className="digest-heading"><div><span className="eyebrow">2026년 7월호</span><h1>통합본 만들기</h1><p>승인된 책방의 핵심 소식을 고르고 순서를 확인하세요.</p></div><button className="primary-button" onClick={() => downloadHtml("지관서가-2026-07-통합본", combinedHtml)}>통합 HTML 다운로드 ↓</button></div>
              <div className="digest-grid">
                <div className="digest-controls">
                  <h2>수록 소식</h2><p>승인된 책방만 통합본에 표시됩니다.</p>
                  {submissions.map((submission, index) => (
                    <div className={`digest-bookstore ${submission.status !== "승인" ? "disabled" : ""}`} key={submission.id}>
                      <div className="digest-bookstore-head"><span className="drag">⠿</span><div><strong>{index + 1}. {submission.bookstore}</strong><small>{submission.region} · {submission.status}</small></div></div>
                      {submission.news.map((news) => (
                        <label className="digest-choice" key={news.id}><input type="checkbox" checked={news.includeInDigest && submission.status === "승인"} disabled={submission.status !== "승인"} onChange={() => toggleDigest(submission.id, news.id)} /><span><strong>{news.title}</strong><small>{news.summary || news.description}</small></span></label>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="digest-preview"><div className="preview-label"><span>통합 HTML 미리보기</span><button onClick={() => navigator.clipboard.writeText(combinedHtml).then(() => notify("HTML을 복사했습니다."))}>코드 복사</button></div><iframe title="통합본 미리보기" srcDoc={`<!doctype html><html><body style="margin:0;background:#f3f1ec;padding:24px;">${combinedHtml}</body></html>`} /></div>
              </div>
            </section>
          )}
        </div>
      )}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
