import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const applicationSourceFiles = [
  "../hooks/use-studio-controller.ts",
  "../hooks/use-body-scroll-lock.ts",
  "../hooks/use-workspace-initialization.ts",
  "../hooks/use-workspace-persistence.ts",
  "../hooks/use-editing-presence.ts",
  "../lib/html-generators.ts",
  "../lib/improvement-export.ts",
  "../lib/improvement-types.ts",
  "../lib/improvements-client.ts",
  "../lib/workspace-client.ts",
  "../lib/workspace-formatters.ts",
  "../components/atoms/BrandIdentity.tsx",
  "../components/atoms/BrandButton.tsx",
  "../components/atoms/ImprovementStatusChip.tsx",
  "../components/atoms/LoadingBooks.tsx",
  "../components/atoms/WorkStatusBadge.tsx",
  "../components/molecules/AppHeader.tsx",
  "../components/molecules/NewsCalendar.tsx",
  "../components/molecules/NewsEditorCard.tsx",
  "../components/molecules/EditingPresenceNotice.tsx",
  "../components/molecules/PublicNewsDetail.tsx",
  "../components/molecules/SubmissionPreviewDialog.tsx",
  "../components/molecules/StudioFeedback.tsx",
  "../components/molecules/StorageLoadingOverlay.tsx",
  "../components/molecules/UtilityPageHeader.tsx",
  "../components/organisms/BookstoreManagement.tsx",
  "../components/organisms/HtmlWorkspace.tsx",
  "../components/organisms/HelpWorkspace.tsx",
  "../components/organisms/ImprovementsWorkspace.tsx",
  "../components/organisms/InputWorkspace.tsx",
  "../components/organisms/NewsEditorWorkspace.tsx",
  "../components/organisms/VisitorWorkspace.tsx",
  "../components/templates/StudioPage.tsx",
];

async function readApplicationSource() {
  return (await Promise.all(applicationSourceFiles.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
}

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the public bookstore news calendar", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /止觀書架/);
  assert.match(html, /동네책방 소식/);
  assert.match(html, />소식 입력<\/button>/);
  assert.match(html, />HTML 편집<\/button>/);
  assert.match(html, /href="\/improvements"/);
  assert.match(html, />개선사항<\/a>/);
  assert.match(html, /href="\/help"/);
  assert.match(html, />도움말<\/a>/);
  assert.doesNotMatch(html, /작업자 접속/);
  assert.match(html, /2026년 7월/);
  assert.match(html, /aria-label="이전 달"/);
  assert.match(html, /aria-label="다음 달"/);
  assert.match(html, /aria-label="책방 색상 안내"/);
  assert.match(html, /책방별 소식/);
  assert.doesNotMatch(html, /상반기 문학 독서모임 마무리|소담쓰담|수연목서/);
  assert.doesNotMatch(html, /가까운 동네책방에서 열리는|<small>일정<\/small>|전체 일정|소식 월/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("renders a responsive help page with the downloadable PDF guide", async () => {
  const response = await render("/help");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>사용 가이드 \| 지관서가 동네책방 소식<\/title>/);
  assert.match(html, /Word를 작성하듯, 책방 소식을 한 곳씩 입력하세요/);
  assert.match(html, /PDF 가이드 열기/);
  assert.match(html, /href="\/guides\/bookstore-news-input-guide\.pdf"/);
  assert.match(html, /소식 제목, 상세 내용/);
  assert.match(html, /자동 저장을 확인하고 책방별로 입력을 마무리합니다/);
  assert.doesNotMatch(html, /wlrhkstjrk|SUPABASE_SECRET_KEY/);
  const guide = await stat(new URL("../public/guides/bookstore-news-input-guide.pdf", import.meta.url));
  assert.ok(guide.size > 100_000, "배포용 사용자 가이드 PDF가 비어 있으면 안 됩니다.");
});

test("renders public improvement intake with worker-only management and portable exports", async () => {
  const [response, route, migration, globalStyles] = await Promise.all([
    render("/improvements"),
    readFile(new URL("../app/api/improvements/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607240001_improvement_requests.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>개선사항 \| 지관서가 동네책방 소식<\/title>/);
  assert.match(html, /개선사항 접수하기/);
  assert.match(html, /접수된 개선사항/);
  assert.match(html, /제목과 내용만 적으면 됩니다/);
  assert.match(route, /export async function (GET|POST|PUT)/);
  assert.match(route, /canManage: Boolean\(await readWorkerSession\(request\)\)/);
  assert.match(route, /if \(!await readWorkerSession\(request\)\)/);
  assert.match(route, /\.eq\("updated_at", updatedAt\)/);
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(migration, /create table if not exists public\.improvement_requests/);
  assert.match(migration, /check \(status in \('received', 'checking', 'in_progress', 'resolved'\)\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.improvement_requests from anon, authenticated/);
  assert.match(globalStyles, /styles\/utility-pages\.css/);

  const source = await readApplicationSource();
  assert.match(source, /통합본 복사/);
  assert.match(source, /MD 다운로드/);
  assert.match(source, /JSON 다운로드/);
  assert.match(source, /IMPROVEMENT_STATUS_LABELS/);
  assert.match(source, /improvement-honeypot/);
});

test("guards the first visit with a three-attempt storage loading screen", async () => {
  const [source, workspaceClient, globalStyles] = await Promise.all([
    readApplicationSource(),
    readFile(new URL("../lib/workspace-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /const MAX_ATTEMPTS = 3/);
  assert.match(source, /const DELAY_NOTICE_MS = 8_000/);
  assert.match(source, /const ATTEMPT_TIMEOUT_MS = 12_000/);
  assert.match(source, /await wait\(attempt \* 2_000\)/);
  assert.doesNotMatch(source, /workspace\.bookstores\.length === 0/);
  assert.match(source, /아직 등록된 동네책방 소식이 없습니다/);
  assert.match(source, /동네 책방에 잠시 들러 새로운 소식을 모으고 있어요/);
  assert.match(source, /책방으로 가는 길이 조금 막히네요/);
  assert.match(source, /지금 다시 시도/);
  assert.match(source, /다시 불러오기/);
  assert.match(source, /useBodyScrollLock\(\)/);
  assert.match(source, /initialLoadState\.phase === "ready"/);
  assert.match(source, /inert=\{!dataReady \|\| undefined\}/);
  assert.match(workspaceClient, /signal\?: AbortSignal/);
  assert.match(globalStyles, /styles\/startup-loading\.css/);

  const response = await render();
  const html = await response.text();
  assert.match(html, /데이터 연결 중/);
  assert.match(html, /1\/3번째 확인/);
});

test("ships accessible discovery controls and compact public cards", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<title>지관서가 동네책방 소식/);
  assert.match(html, /책방이나 소식 검색/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /href="https:\/\/jigwanseoga\.org\/133"/);
  assert.match(html, /지관서가 동네책방 바로가기/);
  assert.doesNotMatch(html, /aria-label="소식 정렬"|가까운 일정순|최근 수정순|책방 이름순|소식 많은순/);
  assert.doesNotMatch(html, /public-news|public-status|앨리스 먼로의/);
  const source = await readApplicationSource();
  assert.match(source, /public-event-list/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /calendar-markers/);
});

test("keeps passcodes in server environment variables and uses a tab-scoped worker session", async () => {
  const [source, sessionRoute, sessionLibrary, serverLibrary] = await Promise.all([
    readApplicationSource(),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/workspace-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /password\.normalize\("NFC"\)\.trim\(\)/);
  assert.match(source, /fetch\("\/api\/session"/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /bookstore-news-session-id/);
  assert.doesNotMatch(source, /wlrhkstjrk|ACCESS_CODES|x-workspace-code|bookstore-news-access-code/);
  assert.match(sessionRoute, /hasWorkspaceWriteAccess/);
  assert.match(sessionRoute, /createWorkerSession/);
  assert.match(serverLibrary, /INPUT_ACCESS_CODES/);
  assert.match(serverLibrary, /HTML_ACCESS_CODES/);
  assert.doesNotMatch(serverLibrary, /wlrhkstjrk|지관서가/);
  assert.match(sessionLibrary, /httpOnly: true/);
  assert.match(sessionLibrary, /sameSite: "strict"/);
  assert.match(sessionLibrary, /x-workspace-session-id/);
  assert.match(source, /한글·영문 자판 어느 쪽으로 입력해도 됩니다/);
  assert.match(source, /완료 내용 공유하기/);
  assert.match(source, /const bookstoreDetails = complete\.map/);
  assert.match(source, /news\.title/);
  assert.match(source, /const resetVisitorPage = \(\) =>/);
  assert.match(source, /setMonth\(initialMonth\)/);
  assert.match(source, /currentKstMonth/);
  assert.match(source, /setSelectedDay\(""\)/);
  assert.match(source, /setSearch\(""\)/);
  assert.doesNotMatch(source, /SortMode|sortMode|setSortMode/);
  assert.doesNotMatch(source, /flatMap\(\(news\) => news\.dates\)\.length/);
  assert.match(source, /const hasDraftInProgress =/);
  assert.match(source, /addEventListener\("beforeunload"/);
  assert.match(source, /\.brand, \.worker-nav button, \.editor-page-head \.back-button/);
  assert.match(source, /작성 중인 내용이 있습니다\./);
  assert.match(source, /임시 저장 후 나가기/);
  assert.match(source, /<BrandButton onClick=\{returnToVisitor\} \/>/);
  assert.match(source, /aria-label="동네책방 소식 홈"/);
  assert.match(source, /<button onClick=\{returnToVisitor\}>로그아웃<\/button>/);
  assert.match(source, /← 뒤로가기/);
  assert.doesNotMatch(source, /장의 사진 업로드|월별 현황 메시지 복사|completion-modal|재게시를 알려주세요|setCompletion/);
});

test("blocks bookstore entry while another worker owns the short database lease", async () => {
  const [source, controller, inputWorkspace, presenceRoute, migration, globalStyles] = await Promise.all([
    readApplicationSource(),
    readFile(new URL("../hooks/use-studio-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/organisms/InputWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/presence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607220002_editing_leases.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /useEditingPresence/);
  assert.match(source, /const HEARTBEAT_MS = 60_000/);
  assert.match(source, /다른 .*가 이 내용을 편집 중입니다/);
  assert.match(source, /저장 충돌이 발생할 수 있습니다/);
  assert.match(controller, /await heartbeatEditingPresence\(\{ scope: "submission", month, bookstoreId \}\)/);
  assert.match(controller, /if \(!result\.owned\) \{[\s\S]+setEditingEntryBlock\([\s\S]+reason: "occupied"[\s\S]+return;/);
  assert.ok(
    controller.indexOf("await heartbeatEditingPresence") < controller.indexOf("ensureSubmission(bookstoreId);"),
    "편집 임대를 확보하기 전에 Submission을 만들거나 편집 화면으로 진입하면 안 됩니다.",
  );
  assert.match(inputWorkspace, /onClick=\{\(\) => void openBookstore\(bookstore\.id\)\}/);
  assert.match(inputWorkspace, /disabled=\{openingBookstoreId !== null\}/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /에 지금 들어갈 수 없습니다/);
  assert.match(source, /약 3분 뒤 자동으로 편집할 수 있습니다/);
  assert.match(source, /편집 상태를 확인하지 못해 안전하게 진입을 멈췄습니다/);
  assert.match(presenceRoute, /const LEASE_SECONDS = 180/);
  assert.match(presenceRoute, /acquire_editing_lease/);
  assert.match(presenceRoute, /workspaceSessionFingerprint/);
  assert.match(migration, /create table if not exists public\.editing_leases/);
  assert.match(migration, /on conflict \(resource_key\) do update/);
  assert.match(migration, /editing_leases\.expires_at <= now\(\)/);
  assert.match(globalStyles, /styles\/presence\.css/);
});

test("supports Word-like optional fields, detail views, and photo ordering", async () => {
  const source = await readApplicationSource();
  assert.match(source, /이번 달 운영 안내/);
  assert.match(source, /일정 안내/);
  assert.match(source, /신청 방법/);
  assert.match(source, /자유로운 추가 항목/);
  assert.match(source, /관련 링크/);
  assert.match(source, /optional-fields/);
  assert.match(source, /reorderImages/);
  assert.match(source, /moveImage/);
  assert.match(source, /PublicNewsDetail/);
  assert.match(source, /public-detail-photos/);
  assert.match(source, /news\.includeInDigest\)\.map\(\(news\) => `<li[^`]+\$\{escapeHtml\(news\.title\)\}<\/li>`/);
  assert.doesNotMatch(source, /news\.description\.slice\(0, 80\)/);
});

test("packages a preview document and paste-ready HTML text for editors", async () => {
  const source = await readApplicationSource();
  assert.match(source, /const pasteReadyHtml = generatedHtml\(submission, bookstore, false\)/);
  assert.match(source, /_HTML코드_복사용\.txt`\, pasteReadyHtml\)/);
  assert.match(source, /<body>\$\{pasteReadyHtml\}<\/body>/);
  assert.match(source, /HTML·TXT·사진 ZIP/);
  assert.match(source, /미리보기 HTML, 복사용 TXT, 원본 사진을 한 번에 받습니다/);
});

test("guides input work and focuses the first missing required field", async () => {
  const source = await readApplicationSource();
  assert.match(source, /① 발행 월 확인/);
  assert.match(source, /② 소식 작성/);
  assert.match(source, /③ 입력 마무리/);
  assert.match(source, /className="input-month-nav"/);
  assert.match(source, /이번 달 작업 진행률/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(source, /data-required-field="title"/);
  assert.match(source, /data-required-field="description"/);
  assert.doesNotMatch(source, /className="month-toolbar"/);
});

test("lets input workers preview the current draft before completion", async () => {
  const [source, visitorStyles] = await Promise.all([
    readApplicationSource(),
    readFile(new URL("../styles/visitor.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /작성 내용 미리보기/);
  assert.match(source, /SubmissionPreviewDialog/);
  assert.match(source, /generatedHtml\(submission, bookstore, true\)/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /작성 중인 내용/);
  assert.match(source, /max-width:700px;margin:20px auto/);
  assert.match(source, /useBodyScrollLock\(\)/);
  assert.match(source, /body\.style\.position = "fixed"/);
  assert.match(source, /root\.style\.overflow = "hidden"/);
  assert.match(source, /window\.scrollTo\(0, scrollY\)/);
  assert.match(visitorStyles, /public-detail-photos\.single-photo \{ justify-content:center; \}/);
  assert.match(visitorStyles, /align-items:center/);
  assert.match(visitorStyles, /object-position:center/);
});

test("uses record-scoped Supabase writes with private originals and public mobile previews", async () => {
  const [pageSource, workspaceRoute, bookstoreRoute, submissionRoute, persistenceHook, imageRoute, migration] = await Promise.all([
    readApplicationSource(),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookstores/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/submissions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/use-workspace-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/images/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607220001_secure_media_and_flexible_fields.sql", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /useState<Bookstore\[]>\(\[\]\)/);
  assert.match(pageSource, /useState<Submission\[]>\(\[\]\)/);
  assert.match(pageSource, /fetch\("\/api\/workspace"/);
  assert.match(pageSource, /fetch\("\/api\/images"/);
  assert.match(pageSource, /createImagePreview/);
  assert.match(pageSource, /reserveImageUpload/);
  assert.match(pageSource, /uploadFileToSignedUrl/);
  assert.match(pageSource, /imageUploadInProgressRef/);
  assert.match(pageSource, /사진을 업로드하는 중입니다/);
  assert.match(pageSource, /errorText\.includes\("already exists"\)/);
  assert.match(pageSource, /String\(storageError\?\.statusCode\) === "409"/);
  assert.match(pageSource, /item\.originalUrl \|\| item\.url/);
  assert.doesNotMatch(pageSource, /localStorage|seedBookstores|seedSubmissions|readAsDataURL/);
  assert.match(workspaceRoute, /전체 Workspace API는 읽기 전용/);
  assert.doesNotMatch(workspaceRoute, /export async function (PUT|POST)/);
  assert.match(workspaceRoute, /readWorkerSession/);
  assert.match(bookstoreRoute, /\.eq\("updated_at", bookstore\.updatedAt\)/);
  assert.match(submissionRoute, /\.eq\("updated_at", submission\.updatedAt\)/);
  assert.match(bookstoreRoute, /WORKSPACE_CONFLICT/);
  assert.match(submissionRoute, /WORKSPACE_CONFLICT/);
  assert.match(persistenceHook, /operationRef/);
  assert.match(persistenceHook, /serialize/);
  assert.match(persistenceHook, /WorkspaceConflictError/);
  assert.doesNotMatch(pageSource, /persistWorkspace\(/);
  assert.match(imageRoute, /originals\//);
  assert.match(imageRoute, /previews\//);
  assert.match(imageRoute, /ORIGINAL_IMAGE_BUCKET/);
  assert.match(imageRoute, /PREVIEW_IMAGE_BUCKET/);
  assert.match(imageRoute, /createSignedUploadUrl\(originalPath\)/);
  assert.match(imageRoute, /createSignedUploadUrl\(previewPath\)/);
  assert.match(imageRoute, /STORAGE_EXTENSION_BY_TYPE/);
  assert.match(imageRoute, /const originalExtension = STORAGE_EXTENSION_BY_TYPE\[body\.type\]/);
  assert.match(imageRoute, /\$\{uniqueId\}\.\$\{originalExtension\}/);
  assert.doesNotMatch(imageRoute, /`\$\{uniqueId\}-\$\{originalName\}`/);
  assert.doesNotMatch(imageRoute, /\uAC00-\uD7A3/);
  assert.match(imageRoute, /validStoragePath/);
  assert.match(imageRoute, /body\.images\.length > 500/);
  assert.doesNotMatch(imageRoute, /request\.formData\(\)/);
  assert.match(pageSource, /uploadFileToSignedUrl\(reservation\.uploads\.originalUrl, file, "300"\)/);
  assert.match(pageSource, /await saveSubmissionChange/);
  assert.match(pageSource, /await deleteStoredImages\(reserved\)/);
  assert.match(imageRoute, /원본 사진 다운로드 권한/);
  assert.match(imageRoute, /원본 사진을 찾지 못했습니다/);
  assert.match(migration, /alter table public\.bookstores/);
  assert.match(migration, /alter table public\.submissions/);
  assert.match(migration, /bookstore-news-originals/);
  assert.match(migration, /bookstore-news-previews/);
  assert.match(migration, /false,/);
  assert.match(migration, /true,/);

  const response = await render("/api/workspace");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /공용 저장소 연결 정보가 필요합니다/);
});

test("keeps the route and global stylesheet as thin Atomic Design composition points", async () => {
  const [pageSource, globalStyles, templateSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/templates/StudioPage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /<StudioPage initialMonth=\{currentKstMonth\(\)\} \/>/);
  assert.ok(pageSource.split("\n").length <= 10);
  assert.match(templateSource, /VisitorWorkspace/);
  assert.match(templateSource, /InputWorkspace/);
  assert.match(templateSource, /HtmlWorkspace/);
  assert.match(globalStyles, /styles\/foundations\.css/);
  assert.match(globalStyles, /styles\/startup-loading\.css/);
  assert.match(globalStyles, /styles\/visitor\.css/);
  assert.match(globalStyles, /styles\/input\.css/);
  assert.match(globalStyles, /styles\/html-editor\.css/);
  assert.match(globalStyles, /styles\/presence\.css/);
  assert.doesNotMatch(globalStyles, /\.visitor-page|\.input-area|\.html-workspace/);
});
