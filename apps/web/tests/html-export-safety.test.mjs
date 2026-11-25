import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundleWithOwnedService } from "./helpers/esbuild-owned-bundle.mjs";

// Bundle the real generator and formatters so the exported HTML is checked, not a copy of its rules.
const { result: bundled } = await bundleWithOwnedService({
  stdin: { contents: 'export * from "./lib/html-generators.ts"; export * from "./lib/workspace-formatters.ts"; export * from "./lib/news-zip-package.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  bundle: true, write: false, platform: "node", format: "esm",
});
const { generatedHtml, newsImageFilename, newsZipPlan, safeFilename, makeNews, makeSubmission, blankBookstore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const image = (name, url = "https://example.invalid/a.jpg") => ({ id: 9, name, originalPath: "", previewPath: "", originalUrl: "", url, caption: "" });
function fixture(images) {
  const bookstore = { ...blankBookstore(), id: 1, name: "테스트 책방", region: "테스트 지역" };
  const submission = { ...makeSubmission(1, "2026-12"), id: 2, news: [{ ...makeNews(3), title: "행사", description: "본문", images }] };
  return { bookstore, submission };
}

test("HTML-SAFE-01 photo names keep valid extensions and never escape the comment", () => {
  const name = (file) => newsImageFilename("2026-12", "책방", 0, 0, "행사", file);
  assert.equal(name("photo.jpg"), "2026-12_책방_01_01_행사.jpg");
  assert.equal(name("Photo.JPG"), "2026-12_책방_01_01_행사.JPG");
  assert.equal(name("a.b.heic"), "2026-12_책방_01_01_행사.heic");
  for (const file of ["IMG_0001", "a.", "x.jpg --><script>alert(1)</script>", "x.exe"]) assert.equal(name(file), "2026-12_책방_01_01_행사.jpg");
  const { bookstore, submission } = fixture([image("x.jpg --><b>주입</b>")]);
  const html = generatedHtml(submission, bookstore, false);
  assert.equal((html.match(/-->/g) || []).length, 1);
  assert.ok(html.includes("<!-- IMAGE: 2026-12_테스트_책방_01_01_행사.jpg -->"));
  assert.ok(!html.includes("<b>주입</b>"));
});

test("HTML-SAFE-02 names stay within 50 units without splitting emoji", () => {
  assert.equal(safeFilename("가".repeat(60)), "가".repeat(50));
  assert.equal(safeFilename(`${"가".repeat(49)}📚끝`), "가".repeat(49));
  assert.equal(safeFilename(`${"가".repeat(48)}📚끝`), `${"가".repeat(48)}📚`);
  assert.equal(safeFilename('a/b:c*d?"e<f>g|h  i'), "abcdefgh_i");
  const { bookstore, submission } = fixture([image("a.jpg", 'https://example.invalid/a.jpg" onerror="alert(1)')]);
  assert.match(generatedHtml(submission, bookstore, true), /<img src="https:\/\/example\.invalid\/a\.jpg&quot; onerror=&quot;alert\(1\)" /);
});

test("HTML-SAFE-03 every ZIP path uses the shared name and an escaped title", async () => {
  const [zipSource, controller, generator] = await Promise.all(["../lib/news-zip-package.ts", "../hooks/use-studio-controller.ts", "../lib/html-generators.ts"]
    .map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.equal((zipSource.match(/newsImageFilename\(submission\.month, bookstore\.name,/g) || []).length, 2);
  assert.match(zipSource, /<title>\$\{escapeHtml\(bookstore\.name\)\}<\/title>/);
  for (const source of [zipSource, controller, generator]) assert.doesNotMatch(source, /\.name\.split\("\."\)\.pop\(\)/);
  assert.match(controller, /const plan = newsZipPlan\(submission, bookstore, withHtml\)/);
});

test("ZIP-PLAN-01 the extracted plan keeps the previous ZIP layout and order", () => {
  const { bookstore, submission } = fixture([{ ...image("one.PNG"), originalUrl: "https://example.invalid/original.png" }, image("two")]);
  submission.news.push({ ...makeNews(4), title: "둘째 소식", description: "본문", images: [] });
  const photos = newsZipPlan(submission, bookstore, false);
  assert.deepEqual(photos, { filename: "2026-12_테스트_책방_사진.zip", photoFolder: "사진", documents: [], photos: [
    { name: "2026-12_테스트_책방_01_01_행사.PNG", url: "https://example.invalid/original.png" },
    { name: "2026-12_테스트_책방_01_02_행사.jpg", url: "https://example.invalid/a.jpg" }] });
  const bundle = newsZipPlan(submission, bookstore, true);
  assert.equal(bundle.filename, "2026-12_테스트_책방_작업파일.zip");
  assert.deepEqual(bundle.photos, photos.photos);
  assert.deepEqual(bundle.documents.map((document) => document.name), ["2026-12_테스트_책방.html", "2026-12_테스트_책방_HTML코드_복사용.txt", "사진배치안내.txt"]);
  const pasteReady = generatedHtml(submission, bookstore, false);
  assert.equal(bundle.documents[0].content, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>테스트 책방</title></head><body>${pasteReady}</body></html>`);
  assert.equal(bundle.documents[1].content, pasteReady);
  assert.equal(bundle.documents[2].content, "1. 행사\n- 2026-12_테스트_책방_01_01_행사.PNG\n- 2026-12_테스트_책방_01_02_행사.jpg\n\n2. 둘째 소식\n");
});
