// Opt-in browser regression: all API calls are mocked; no environment files or DB clients are loaded.
// npm run build && PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright/index.mjs node tests/browser-loading.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const { default: worker } = await import("../dist/server/index.js");
const root = resolve("dist/client");
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
let escapedApiRequests = 0;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) {
    escapedApiRequests += 1;
    res.writeHead(503); res.end("API mock required"); return;
  }
  try {
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}/`)) throw new Error("not an asset");
    const bytes = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" }); res.end(bytes);
  } catch {
    try {
      const response = await worker.fetch(new Request(`http://127.0.0.1:${server.address().port}${req.url}`), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end("Local render failed"); }
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, acceptDownloads: true });
page.setDefaultTimeout(20_000);
const errors = [];
let consoleErrors = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors++; });
const counts = { post: 0, get: 0, delete: 0, save: 0, image: 0 };
const statusCounts = {};
page.on("response", (response) => {
  if (new URL(response.url()).pathname.startsWith("/api/")) statusCounts[response.status()] = (statusCounts[response.status()] || 0) + 1;
});
let rejectLogin = false, failWorkspace = false, failLogout = false, failSave = false, failImage = false;
let dropLogoutResponse = false;
let delay = 0, workerDelay = 0, saveDelay = 0;
let currentRole = "input";
let sessionActive = false, leaseActive = false;
const stamp = "2026-09-22T00:00:00.000Z";
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
let workspace = {
  bookstores: [{ id: 1, updatedAt: stamp, sortOrder: 0, name: "QA 책방", region: "서울", address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [] }],
  submissions: [{ id: 101, bookstoreId: 1, month, status: "completed", updatedAt: stamp, completedAt: stamp, publishedAt: "", publishedUrl: "", monthlyNotice: "", news: [{ id: 1001, title: "QA 소식", description: "QA 상세 내용", dates: [], scheduleRange: null, scheduleText: "", regular: false, displayLabel: "", deadline: "", place: "", fee: "", applicationInfo: "", applyUrl: "", extraFields: [], links: [], includeInDigest: true, images: [1, 2].map((id) => ({ id, name: `qa-${id}.gif`, originalPath: `qa/${id}.gif`, previewPath: `qa/${id}.gif`, originalUrl: `/api/mock-image/${id}`, url: pixel, caption: "" })) }] }],
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
await page.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin && url.protocol !== "data:") return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname === "/api/session") {
    const method = request.method(); counts[method === "POST" ? "post" : method === "DELETE" ? "delete" : "get"]++;
    await pause(delay);
    if (method === "DELETE") {
      assert.equal(leaseActive, false, "release editing lease before deleting session");
      if (failLogout) return json(400, { error: "QA logout failure" });
      if (dropLogoutResponse) { sessionActive = false; return route.abort("failed"); }
      sessionActive = false; return route.fulfill({ status: 204 });
    }
    if (method === "POST") { if (rejectLogin) return json(401, { error: "QA 암호 오류" }); currentRole = request.postDataJSON().role; sessionActive = true; }
    return json(200, { role: currentRole });
  }
  if (url.pathname === "/api/workspace") {
    if (request.headers()["x-workspace-session-id"]) { await pause(workerDelay); if (failWorkspace) return json(400, { error: "QA workspace failure" }); }
    return json(200, workspace);
  }
  if (url.pathname === "/api/presence") {
    if (!sessionActive) return json(401, { error: "QA expired session" });
    leaseActive = request.method() !== "DELETE";
    return request.method() === "DELETE" ? route.fulfill({ status: 204 }) : json(200, { owned: true, activeRole: currentRole, expiresAt: "2099-01-01T00:00:00.000Z" });
  }
  if (url.pathname === "/api/submissions") {
    counts.save++; const submission = request.postDataJSON().submission; await pause(saveDelay);
    if (failSave) return json(400, { error: "QA save failure" });
    const saved = { ...submission, updatedAt: new Date().toISOString() }; workspace.submissions = [saved]; return json(200, { submission: saved });
  }
  if (url.pathname.startsWith("/api/mock-image/")) { counts.image++; await pause(delay); return failImage ? json(404, { error: "QA image failure" }) : route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from(pixel.split(",")[1], "base64") }); }
  throw new Error(`Unmocked API path: ${url.pathname}`);
});
const visible = async (locator) => { await locator.waitFor({ state: "visible" }); };
const submit = () => page.locator(".access-modal .primary-button");
const login = async (role = "input") => {
  await page.getByRole("button", { name: role === "input" ? "소식 입력" : "HTML 편집", exact: true }).click();
  await page.locator('input[type="password"]').fill("local-fixture-only");
  await submit().click();
};
const results = [];
const pass = (name) => { results.push(name); console.log(`PASS ${name}`); };
try {
  await page.goto(origin);
  await visible(page.getByRole("button", { name: "소식 입력", exact: true }));
  delay = 350; workerDelay = 450;
  await login();
  await visible(page.getByText("작업 암호를 확인하고 있어요.", { exact: true }));
  await submit().evaluate((button) => { button.click(); button.click(); });
  assert.equal(await page.locator('input[type="password"]').isDisabled(), true);
  await visible(page.getByText("동네책방 작업 공간을 준비하고 있어요.", { exact: true }));
  await visible(page.getByRole("heading", { name: "책방 소식 입력", exact: true }));
  assert.equal(counts.post, 1); pass("TC-AUTH-005 delayed phases and duplicate login");
  await page.getByTitle("메인 페이지로 이동", { exact: true }).click();
  const before = counts.get;
  await page.getByRole("button", { name: "소식 입력", exact: true }).evaluate((button) => { button.click(); button.click(); });
  await visible(page.getByText("동네책방 작업 공간을 준비하고 있어요.", { exact: true }));
  await visible(page.getByRole("heading", { name: "책방 소식 입력", exact: true }));
  assert.equal(counts.get, before + 1); assert.equal(counts.post, 1); pass("TC-AUTH-003 preserved session resume");
  failLogout = true;
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await visible(page.getByRole("button", { name: "로그아웃 중...", exact: true }));
  await visible(page.getByRole("button", { name: "로그아웃", exact: true }));
  assert.equal(await page.evaluate(() => sessionStorage.getItem("bookstore-news-role")), "input");
  failLogout = false;
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await visible(page.getByRole("button", { name: "소식 입력", exact: true }));
  assert.equal(await page.evaluate(() => sessionStorage.getItem("bookstore-news-role")), null); pass("TC-AUTH-005 logout delay/failure/retry");
  failWorkspace = true;
  await login();
  await page.waitForFunction(() => document.querySelector('.access-modal .primary-button')?.disabled === false);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("bookstore-news-session-id")), null);
  assert.equal(await page.locator('input[type="password"]').evaluate((input) => input === document.activeElement), true);
  failWorkspace = false; await submit().click();
  await visible(page.getByRole("heading", { name: "책방 소식 입력", exact: true })); pass("TC-AUTH-005 workspace failure rollback and recovery");
  await page.getByRole("button", { name: /QA 책방/ }).click();
  await visible(page.getByRole("button", { name: "임시 저장", exact: true }));
  saveDelay = 500; failSave = true;
  await page.locator(".monthly-notice-card textarea").fill("QA unsaved notice");
  await page.getByRole("button", { name: "임시 저장", exact: true }).click();
  await visible(page.getByRole("button", { name: "임시 저장 중...", exact: true }));
  assert.equal(await page.getByRole("button", { name: "입력 마무리", exact: true }).isDisabled(), true);
  await visible(page.getByRole("button", { name: "임시 저장", exact: true }));
  assert.equal(await page.locator(".monthly-notice-card textarea").inputValue(), "QA unsaved notice");
  await page.getByRole("button", { name: "← 책방 목록", exact: true }).click();
  await page.getByRole("button", { name: "임시 저장 후 이동", exact: true }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((button) => button.textContent === "계속 작성" && !button.disabled));
  assert.equal(await page.getByRole("button", { name: "계속 작성", exact: true }).evaluate((button) => button === document.activeElement), true);
  await page.getByRole("button", { name: "계속 작성", exact: true }).click();
  failSave = false;
  failLogout = true;
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByRole("button", { name: "저장하지 않고 이동", exact: true }).click();
  await visible(page.getByText("로그아웃하지 못했습니다. 다시 시도해 주세요.", { exact: false }));
  assert.equal(await page.locator(".toast").innerText(), "✓ 로그아웃하지 못했습니다. 다시 시도해 주세요.");
  assert.equal(leaseActive, true, "reacquire the editing lease after failed logout");
  await page.getByRole("button", { name: "계속 작성", exact: true }).click();
  failLogout = false;
  pass("TC-SUB-012 discard logout failure retains error instead of success");
  await page.locator(".monthly-notice-card textarea").fill("QA discarded unsaved notice");
  dropLogoutResponse = true;
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByRole("button", { name: "저장하지 않고 이동", exact: true }).click();
  await visible(page.getByRole("button", { name: "소식 입력", exact: true }));
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), `bookstore-news-draft:${month}:1`), null);
  dropLogoutResponse = false;
  await login();
  await page.getByRole("button", { name: /QA 책방/ }).click();
  assert.notEqual(await page.locator(".monthly-notice-card textarea").inputValue(), "QA discarded unsaved notice");
  pass("TC-SUB-007 discard remains discarded after lost logout response");
  await page.locator(".monthly-notice-card textarea").fill("QA recovered notice");
  await page.getByRole("button", { name: "입력 마무리", exact: true }).click();
  await visible(page.getByRole("button", { name: "입력 완료 저장 중...", exact: true }));
  assert.equal(await page.locator(".editor-form-body").evaluate((element) => element.inert), true);
  await visible(page.getByRole("heading", { name: "책방 소식 입력", exact: true })); pass("TC-SUB-012 save failure preserves draft and completion recovery");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login("html");
  await visible(page.getByRole("button", { name: "HTML·TXT·사진 ZIP", exact: true }));
  failImage = true;
  await page.getByRole("button", { name: "사진 ZIP", exact: true }).click();
  await visible(page.getByText("원본 사진을 모아 다운로드 파일을 준비하고 있어요.", { exact: true }));
  assert.equal(await page.getByRole("button", { name: "HTML·TXT·사진 ZIP", exact: true }).isDisabled(), true);
  await visible(page.getByRole("button", { name: "사진 ZIP", exact: true }));
  failImage = false;
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML·TXT·사진 ZIP", exact: true }).click();
  const download = await downloadEvent; assert.match(download.suggestedFilename(), /작업파일\.zip$/); await download.delete();
  pass("TC-HTML-005 ZIP pending/failure/retry/download");
  dropLogoutResponse = true;
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await visible(page.getByRole("button", { name: "소식 입력", exact: true }));
  assert.equal(await page.evaluate(() => sessionStorage.getItem("bookstore-news-session-id")), null);
  dropLogoutResponse = false;
  pass("TC-AUTH-005 lost logout response closes local session safely");
  workerDelay = 16_000;
  const timeoutStarted = Date.now();
  await login();
  await page.waitForFunction(() => document.querySelector('.access-modal .primary-button')?.disabled === false, null, { timeout: 19_000 });
  assert.ok(Date.now() - timeoutStarted < 19_000);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("bookstore-news-session-id")), null);
  await page.setViewportSize({ width: 360, height: 420 });
  const bounds = await page.locator(".access-modal").boundingBox();
  assert.ok(bounds.width <= 360 && bounds.height <= 420);
  await page.getByRole("button", { name: "접속 창 닫기", exact: true }).click();
  pass("TC-AUTH-005 workspace timeout unlock and compact mobile modal");
  delay = 0; workerDelay = 0; rejectLogin = true;
  const cdp = await page.context().newCDPSession(page); await cdp.send("Performance.enable");
  const samples = [];
  for (let index = 0; index < 12; index++) {
    await login();
    await page.waitForFunction(() => document.querySelector('.access-modal .primary-button')?.disabled === false);
    await page.getByRole("button", { name: "접속 창 닫기", exact: true }).click();
    if ([3, 7, 11].includes(index)) {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      samples.push(Object.fromEntries(metrics.filter(({ name }) => ["JSHeapUsedSize", "Nodes", "JSEventListeners", "Documents"].includes(name)).map(({ name, value }) => [name, value])));
    }
  }
  assert.ok(samples.at(-1).JSHeapUsedSize < samples[0].JSHeapUsedSize * 1.3);
  assert.ok(samples.at(-1).JSEventListeners <= samples[0].JSEventListeners + 5);
  assert.ok(samples.at(-1).Nodes <= samples[0].Nodes + 30);
  assert.equal(escapedApiRequests, 0); assert.deepEqual(errors, []);
  assert.equal(statusCounts[401], 12, "only the intentional wrong-password attempts return 401");
  pass("TC-AUTH-005 12 failure cycles and bounded resource samples");
  console.log(JSON.stringify({ results, counts, statusCounts, samples, escapedApiRequests, pageErrors: errors.length, consoleErrors, viewport: "360x740 and 360x420", dataSafety: "All API responses mocked; no database or Storage calls" }, null, 2));
} finally {
  await browser.close(); await new Promise((done) => server.close(done));
}
