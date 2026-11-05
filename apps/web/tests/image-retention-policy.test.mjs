import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachUploadedImages,
  retainedImageCleanupResult,
  respondToDeferredImageCleanup,
} from "../lib/image-retention-policy.mjs";
import { deleteStoredImages, persistSubmission } from "../lib/workspace-client.ts";

const expectedRetention = { retained: true, deleted: false, code: "IMAGE_CLEANUP_DEFERRED" };
const photo = {
  id: 10.25, name: "test.jpg", originalPath: "originals/test/a.jpg", previewPath: "previews/test/a.jpg",
  originalUrl: "", url: "", caption: "",
};
const target = { submissionId: 1, bookstoreId: 2, month: "2026-06", newsId: 3 };
const makeSubmission = () => ({
  id: 1, bookstoreId: 2, month: "2026-06", status: "draft", futureField: { retained: true },
  news: [{ id: 3, title: "테스트", images: [] }, { id: 4, title: "다른 소식", images: [] }],
});
const reply = (body, status) => ({ body, status });
const request = (images) => ({ json: async () => ({ images }) });

test("IMG-008: cleanup result does not claim existence or attachment success", () => {
  const first = retainedImageCleanupResult();
  assert.deepEqual(first, expectedRetention);
  first.deleted = true;
  assert.deepEqual(retainedImageCleanupResult(), expectedRetention);
});

test("IMG-009: the real client helper sends no DELETE even to an old destructive server", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  let physicalRemovals = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    physicalRemovals += 1;
    return new Response(null, { status: 204 });
  };
  try {
    assert.deepEqual(await deleteStoredImages([photo]), expectedRetention);
    assert.deepEqual(await deleteStoredImages([]), expectedRetention);
    assert.equal(fetchCalls, 0);
    assert.equal(physicalRemovals, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IMG-010: legacy cleanup handler replies 200 retention without a storage dependency", async () => {
  let roleReads = 0;
  const result = await respondToDeferredImageCleanup(request([photo]), async () => { roleReads += 1; return "input"; }, reply);
  assert.equal(roleReads, 1);
  assert.deepEqual(result, { status: 200, body: expectedRetention });
});

test("IMG-011: no session or the HTML role is rejected before parsing image paths", async () => {
  for (const role of [null, "html", "visitor"]) {
    let bodyReads = 0;
    const result = await respondToDeferredImageCleanup({ json: async () => { bodyReads += 1; throw new Error("must not parse"); } }, async () => role, reply);
    assert.equal(result.status, 403);
    assert.equal(bodyReads, 0);
  }
});

test("IMG-012: empty, non-array, malformed and oversized legacy target lists remain invalid", async () => {
  for (const images of [undefined, null, {}, [], [null], [false], [[]], Array.from({ length: 501 }, () => photo)]) {
    const result = await respondToDeferredImageCleanup(request(images), async () => "input", reply);
    assert.equal(result.status, 400);
  }
  const atLimit = await respondToDeferredImageCleanup(request(Array.from({ length: 500 }, () => photo)), async () => "input", reply);
  assert.deepEqual(atLimit, { status: 200, body: expectedRetention });
});

test("IMG-013: legacy path prefix, traversal, backslash, type and length checks remain active", async () => {
  for (const originalPath of ["previews/test/a.jpg", "originals/../a.jpg", "originals/a\\b.jpg", "originals/" + "a".repeat(501), 1]) {
    const result = await respondToDeferredImageCleanup(request([{ originalPath }]), async () => "input", reply);
    assert.equal(result.status, 400);
  }
  for (const previewPath of ["originals/test/a.jpg", "previews/../a.jpg", "previews/a\\b.jpg", "previews/" + "a".repeat(501), 1]) {
    const result = await respondToDeferredImageCleanup(request([{ previewPath }]), async () => "input", reply);
    assert.equal(result.status, 400);
  }
});

test("IMG-014: malformed JSON remains an error for the Route Handler error boundary", async () => {
  const parseError = new SyntaxError("invalid test JSON");
  await assert.rejects(respondToDeferredImageCleanup({ json: async () => { throw parseError; } }, async () => "input", reply), (error) => error === parseError);
});

test("IMG-015: attachment preserves existing, unrelated and future data without mutating input", () => {
  const submission = makeSubmission();
  const existing = { ...photo, id: 11, originalPath: "originals/test/existing.jpg", previewPath: "previews/test/existing.jpg" };
  submission.news[0].images.push(existing);
  const before = structuredClone(submission);
  const saved = attachUploadedImages(submission, target, [photo]);
  assert.deepEqual(submission, before);
  assert.deepEqual(saved.news[0].images, [existing, photo]);
  assert.equal(saved.news[1], submission.news[1]);
  assert.equal(saved.futureField, submission.futureField);
});

test("IMG-016: the queued attachment transform rejects removed or changed targets", () => {
  const missingNews = makeSubmission();
  missingNews.news = missingNews.news.filter((news) => news.id !== target.newsId);
  assert.throws(() => attachUploadedImages(missingNews, target, [photo]), /소식이 변경되거나 제거/);
  for (const changed of [null, { ...makeSubmission(), id: 8 }, { ...makeSubmission(), bookstoreId: 8 }, { ...makeSubmission(), month: "2026-07" }]) {
    assert.throws(() => attachUploadedImages(changed, target, [photo]), /책방과 발행 월/);
  }
});

test("IMG-017: real save/cleanup helpers preserve fake committed paths after lost or malformed acknowledgement", async () => {
  // 실제 HTTP·DB·React가 아니라 실제 client helper + fake transport/ledger 경계입니다.
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: { getItem: () => "fake-retention-test-session" },
    setTimeout: (callback) => globalThis.setTimeout(callback, 0),
  };
  try {
    for (const mode of ["lost", "malformed"]) {
      const ledger = new Set([photo.originalPath, photo.previewPath]);
      const requested = attachUploadedImages(makeSubmission(), target, [photo]);
      const originalError = new Error("fake save acknowledgement lost");
      let committed;
      const requests = [];
      globalThis.fetch = async (url, options) => {
        requests.push({ url, method: options.method });
        assert.equal(url, "/api/submissions");
        assert.equal(options.method, "PUT");
        committed ??= JSON.parse(options.body).submission;
        if (mode === "lost") throw originalError;
        return new Response("malformed test JSON", { status: 200 });
      };
      let reportedError;
      try { await persistSubmission(requested); } catch (error) {
        reportedError = error;
        assert.deepEqual(await deleteStoredImages([photo]), expectedRetention);
      }
      if (mode === "lost") assert.equal(reportedError, originalError);
      else assert.match(reportedError.message, /소식을 저장하지 못했습니다/);
      assert.equal(requests.length, mode === "lost" ? 3 : 1);
      assert.equal(requests.filter((entry) => entry.method === "DELETE").length, 0);
      assert.deepEqual(committed.news[0].images, [photo]);
      assert.deepEqual([...ledger], [photo.originalPath, photo.previewPath]);
    }
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("IMG-018: stale autosave and shared-path reference models do not physically remove files", async () => {
  const ledger = new Set([photo.originalPath, photo.previewPath]);
  const oldSaved = attachUploadedImages(makeSubmission(), target, [photo]);
  oldSaved.news[1].images.push({ ...photo, id: 99 });
  const localRemoved = { ...oldSaved, news: oldSaved.news.map((news) => news.id === 3 ? { ...news, images: [] } : news) };
  for (let attempt = 0; attempt < 1000; attempt += 1) assert.deepEqual(await deleteStoredImages([photo]), expectedRetention);
  assert.equal(oldSaved.news[0].images.length, 1);
  assert.equal(localRemoved.news[0].images.length, 0);
  assert.equal(localRemoved.news[1].images[0].originalPath, photo.originalPath);
  assert.equal(ledger.size, 2);
  // 반복 반환은 확인하지만 heap·브라우저 timer·React lifecycle 측정은 별도 TC입니다.
});

test("IMG-019: source wiring has no pending physical deletion queue or controller cleanup calls", async () => {
  // source assertions are structural guards, not executed React or deployed API evidence.
  const [controller, route, card] = await Promise.all([
    readFile(new URL("../hooks/use-studio-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/images/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/molecules/NewsEditorCard.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(controller, /pendingImageDeletesRef|deleteStoredImages|const reserved:/);
  assert.match(controller, /saveSubmissionChange\(target\.id, \(submission\) => attachUploadedImages\(submission/);
  const deleteRoute = route.slice(route.indexOf("export async function DELETE"), route.indexOf("export async function GET"));
  assert.match(deleteRoute, /respondToDeferredImageCleanup\(request, readWorkerSession/);
  assert.doesNotMatch(deleteRoute, /getSupabaseAdmin|\.remove\(|retryFutureJwt/);
  assert.match(card, /aria-label="소식에서 사진 제거"/);
  assert.match(card, /파일은 안전을 위해 보관됩니다/);
});
