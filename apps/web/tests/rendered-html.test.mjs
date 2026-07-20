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
  assert.match(html, /소식 접수/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships accessible form labels and product-specific metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /<title>책방소식/);
  assert.match(html, /책방 이름/);
  assert.match(html, /통합본용 한 줄 요약/);
  assert.match(html, /검토 요청 보내기/);
});
