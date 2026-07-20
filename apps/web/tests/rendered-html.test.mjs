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

test("renders the bookstore news publishing prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /책방소식/);
  assert.match(html, /소식 작성/);
  assert.match(html, /발행 관리/);
  assert.match(html, /책방 관리/);
  assert.match(html, /소식 접수/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships accessible form labels and product-specific metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<title>책방소식/);
  assert.match(html, /저장된 책방 선택/);
  assert.match(html, /새 책방 등록/);
  assert.match(html, /통합본에 들어갈 한 줄 요약/);
  assert.match(html, /검토 요청 보내기/);
  assert.match(html, /사진 첨부하기/);
  assert.match(html, /여러 사진을 끌어다 놓아도 됩니다/);
  assert.match(html, /날짜·장소·참가비·신청 링크 추가/);
});
