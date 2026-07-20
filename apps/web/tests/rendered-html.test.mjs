import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
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
  assert.match(html, /작업자 접속/);
  assert.match(html, /2026년 7월/);
  assert.match(html, /aria-label="이전 달"/);
  assert.match(html, /aria-label="다음 달"/);
  assert.match(html, /aria-label="책방 색상 안내"/);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /calendar-markers/);
  assert.match(html, /책방별 소식/);
  assert.doesNotMatch(html, /전체 일정|소식 월/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships accessible discovery controls and compact public cards", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<title>지관서가 동네책방 소식/);
  assert.match(html, /책방이나 소식 검색/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="소식 정렬"/);
  assert.match(html, /가까운 일정순/);
  assert.match(html, /public-event-list/);
  assert.match(html, /상반기 문학 독서모임 마무리/);
  assert.doesNotMatch(html, /public-news|public-status|앨리스 먼로의/);
});
