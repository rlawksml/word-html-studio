import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundle the actual generator, resolving its production aliases without changing runtime imports.
const bundled = await build({
  stdin: { contents: 'export * from "./lib/html-generators.ts"; export * from "./lib/workspace-formatters.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  bundle: true, write: false, platform: "node", format: "esm",
});
const { generatedHtml, digestHtml, escapeMultilineHtml, makeNews, makeSubmission, blankBookstore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function fixture() {
  const bookstore = { ...blankBookstore(), id: 1, name: "테스트 책방", region: "테스트 지역" };
  const submission = { ...makeSubmission(1, "2026-06"), id: 2, news: [{ ...makeNews(3), title: "테스트 행사" }] };
  return { bookstore, submission, news: submission.news[0] };
}

test("HTML-LINES-01 all newline styles, blank lines, emoji and special characters", () => {
  assert.equal(escapeMultilineHtml('첫줄\r\n둘째\r셋째\n\n📚 & < > " \''), '첫줄<br>둘째<br>셋째<br><br>📚 &amp; &lt; &gt; &quot; &#039;');
  assert.equal(escapeMultilineHtml(""), "");
  assert.equal(escapeMultilineHtml("\n끝\n"), "<br>끝<br>");
});

test("HTML-LINES-02 actual generated body and every multiline value use explicit breaks", () => {
  const { bookstore, submission, news } = fixture();
  const fields = ["description", "scheduleText", "place", "fee", "applicationInfo"];
  for (const field of fields) news[field] = `${field} 첫줄\r\n둘째\n\n마지막`;
  news.extraFields = [{ id: 4, label: "추가", value: "extra 첫줄\r둘째" }];
  submission.monthlyNotice = "notice 첫줄\n둘째";
  for (const field of ["address", "hours", "phone", "introduction"]) bookstore[field] = `${field} 첫줄\n둘째`;
  bookstore.contacts = [{ id: 5, label: "담당", value: "contact 첫줄\n둘째" }];
  const html = generatedHtml(submission, bookstore);
  for (const field of fields) assert.ok(html.includes(`${field} 첫줄<br>둘째<br><br>마지막`));
  for (const field of ["address", "hours", "phone", "introduction", "notice", "extra", "contact"]) assert.ok(html.includes(`${field} 첫줄<br>둘째`));
  assert.ok(!html.includes("white-space:pre-line"));
});

test("HTML-LINES-03 literal HTML is escaped before converting newlines", () => {
  const { bookstore, submission, news } = fixture();
  news.description = '<script>alert("x")</script>\n<img src=x onerror=alert(1)>\n<br> &amp;';
  const html = generatedHtml(submission, bookstore);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>&lt;img src=x onerror=alert(1)&gt;<br>&lt;br&gt; &amp;amp;'));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
});

test("HTML-LINES-04 preview and copy share body; captions convert but attributes and labels do not", () => {
  const { bookstore, submission, news } = fixture();
  news.description = "본문\n\n다음 문단 📚";
  news.title = "행사\n제목";
  news.links = [{ id: 6, label: "링크\n제목", url: "https://example.invalid/?a=1&b=2" }];
  news.images = [{ id: 7, name: "test.jpg", originalPath: "", previewPath: "", originalUrl: "", url: "https://example.invalid/test.jpg", caption: '사진\n설명 "📚"' }];
  const preview = generatedHtml(submission, bookstore, true);
  const copy = generatedHtml(submission, bookstore, false);
  const body = (html) => html.match(/<p style="margin:0 0 14px;line-height:1.8">(.*?)<\/p>/s)[1];
  assert.equal(body(preview), body(copy));
  assert.equal(body(copy), "본문<br><br>다음 문단 📚");
  assert.match(preview, /<figcaption[^>]*>사진<br>설명 &quot;📚&quot;<\/figcaption>/);
  assert.ok(preview.includes('alt="사진\n설명 &quot;📚&quot;"'));
  assert.ok(preview.includes("행사\n제목"));
  assert.ok(preview.includes("링크\n제목"));
  for (const attribute of preview.matchAll(/\b(?:alt|src|href)="([^"]*)"/g)) assert.ok(!attribute[1].includes("<br>"));
  assert.ok(copy.includes("<!-- IMAGE:"));
  assert.ok(!copy.includes("<figure"));
});

test("HTML-LINES-05 generation never mutates source and digest remains title-only", () => {
  const { bookstore, submission, news } = fixture();
  news.description = "원본\r\n보존\n";
  news.title = "제목\n보존";
  submission.status = "completed";
  const before = structuredClone({ bookstore, submission });
  generatedHtml(submission, bookstore, false);
  generatedHtml(submission, bookstore, true);
  const digest = digestHtml([submission], [bookstore], "2026-06");
  assert.deepEqual({ bookstore, submission }, before);
  assert.ok(digest.includes("제목\n보존"));
  assert.ok(!digest.includes("원본"));
  assert.ok(!digest.includes("<br>"));
});
