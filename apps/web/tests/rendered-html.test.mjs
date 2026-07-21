import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /public-event-list/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /calendar-markers/);
});

test("uses the configured passcodes and consolidated completion sharing", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /input: \["지관서가", "wlrhkstjrk"\]/);
  assert.match(source, /html: \["지관서가2", "wlrhkstjrk2"\]/);
  assert.match(source, /password\.normalize\("NFC"\)\.trim\(\)/);
  assert.match(source, /ACCESS_CODES\[accessRole\]\.includes\(normalizedPassword\)/);
  assert.match(source, /한글·영문 자판 어느 쪽으로 입력해도 됩니다/);
  assert.match(source, /완료 내용 공유하기/);
  assert.match(source, /const bookstoreDetails = complete\.map/);
  assert.match(source, /news\.title/);
  assert.match(source, /const resetVisitorPage = \(\) =>/);
  assert.match(source, /setMonth\(INITIAL_MONTH\)/);
  assert.match(source, /setSelectedDay\(""\)/);
  assert.match(source, /setSearch\(""\)/);
  assert.doesNotMatch(source, /SortMode|sortMode|setSortMode/);
  assert.doesNotMatch(source, /flatMap\(\(news\) => news\.dates\)\.length/);
  assert.match(source, /const hasDraftInProgress =/);
  assert.match(source, /addEventListener\("beforeunload"/);
  assert.match(source, /\.brand, \.worker-nav button, \.editor-page-head \.back-button/);
  assert.match(source, /작성 중인 내용이 있습니다\./);
  assert.match(source, /임시 저장 후 나가기/);
  assert.match(source, /onClick=\{returnToVisitor\} aria-label="동네책방 소식 홈"/);
  assert.match(source, /<button onClick=\{returnToVisitor\}>로그아웃<\/button>/);
  assert.match(source, /← 뒤로가기/);
  assert.doesNotMatch(source, /password === "input"|password === "html"|password === "wlrhkstjrk"|password === "wlrhkstjrk2"/);
  assert.doesNotMatch(source, /장의 사진 업로드|월별 현황 메시지 복사|completion-modal|재게시를 알려주세요|setCompletion/);
});

test("guides input work and focuses the first missing required field", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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

test("uses Supabase as the clean shared source of truth", async () => {
  const [pageSource, workspaceRoute, imageRoute, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/images/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607210001_initial_workspace.sql", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /useState<Bookstore\[]>\(\[\]\)/);
  assert.match(pageSource, /useState<Submission\[]>\(\[\]\)/);
  assert.match(pageSource, /fetch\("\/api\/workspace"/);
  assert.match(pageSource, /fetch\("\/api\/images"/);
  assert.match(pageSource, /createImagePreview/);
  assert.match(pageSource, /item\.originalUrl \|\| item\.url/);
  assert.doesNotMatch(pageSource, /localStorage|seedBookstores|seedSubmissions|readAsDataURL/);
  assert.match(workspaceRoute, /replace_bookstore_news_workspace/);
  assert.match(workspaceRoute, /NEWS_IMAGE_BUCKET/);
  assert.match(imageRoute, /originals\//);
  assert.match(imageRoute, /previews\//);
  assert.match(migration, /create table if not exists public\.bookstores/);
  assert.match(migration, /create table if not exists public\.submissions/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /'bookstore-news'/);

  const response = await render("/api/workspace");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /공용 저장소 연결 정보가 필요합니다/);
});
