// Source/payload compatibility only: no live route, SDK, credentials, DB,
// Storage, deployed artifact, or platform environment is exercised here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  mergeNewsPreservingUnknownFields,
  stripExternalNewsFields,
} from "../lib/submission-json-compatibility.ts";

const validationUrl = new URL("../lib/workspace-validation.ts", import.meta.url);
const recordsUrl = new URL("../lib/workspace-records.ts", import.meta.url);
const { parseSubmission } = await import(validationUrl.href);
// Load the actual old sanitizer, not a copied implementation. Its sole
// runtime import is replaced only for this exact parent module; any cloud
// method invocation throws rather than creating a client or using fetch.
const stubUrl = "bookstore-compatible-fallback:cloud-forbidden";
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === recordsUrl.href && specifier === "@/lib/supabase-server") {
      return { url: stubUrl, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === stubUrl) return {
      format: "module",
      shortCircuit: true,
      source: 'export const PREVIEW_IMAGE_BUCKET = "forbidden"; export function getSupabaseAdmin() { throw new Error("CLOUD_ACCESS_FORBIDDEN"); }',
    };
    return next(url, context);
  },
});
let sanitizeNews;
try {
  ({ sanitizeNews } = await import(recordsUrl.href));
} finally {
  hooks.deregister();
}

function submission() {
  return {
    id: 1, bookstoreId: 1, month: "2026-06", status: "draft", updatedAt: "",
    completedAt: "", publishedAt: "", publishedUrl: "", monthlyNotice: "synthetic QA",
    news: [{
      id: 101, title: "수정 제목 📚", description: "첫째 줄\n둘째 줄", dates: ["2026-06-17"],
      regular: false, includeInDigest: true, scheduleText: "", displayLabel: "",
      deadline: "", place: "QA", fee: "", applicationInfo: "", applyUrl: "",
      images: [{ id: 401, name: "QA.jpg", caption: "수정 설명", originalPath: "originals/qa.jpg", previewPath: "previews/qa.jpg" }],
      extraFields: [{ id: 201, label: "대상", value: "수정 내용" }],
      links: [{ id: 301, label: "안내", url: "https://example.invalid/qa" }],
    }],
  };
}

function existingNews() {
  const news = submission().news;
  news[0].title = "이전 제목";
  news[0].images[0].caption = "이전 설명";
  news[0].extraFields[0].value = "이전 내용";
  news[0].links[0].url = "https://example.invalid/previous";
  news[0].futureNews = { opaque: ["trusted", 1] };
  news[0].images[0].futureImage = { altText: "서버 사진 설명" };
  news[0].extraFields[0].futureExtra = { format: "chip" };
  news[0].links[0].futureLink = { tracking: "trusted" };
  return news;
}

function payload(existing, request) {
  const parsed = parseSubmission(request);
  return stripExternalNewsFields(
    mergeNewsPreservingUnknownFields(existing, sanitizeNews(parsed.news)),
  );
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test("FALLBACK-COMPAT-01 actual old parser/sanitizer source and route chain remain explicit", async () => {
  for (const [url, expected] of [
    [validationUrl, "b2e4b56c828a619c75f067ffb0936c935cd64eca8a6bec786db08044e1185ca4"],
    [recordsUrl, "83ef4154f7e9d00937cd33a67e358ee3726e3267cc4ea871a20449cb10c2c9f3"],
  ]) {
    assert.equal(createHash("sha256").update(await readFile(url)).digest("hex"), expected);
  }
  const route = await readFile(new URL("../app/api/submissions/route.ts", import.meta.url), "utf8");
  assert.match(route, /const submission = parseSubmission\(body\.submission\)/);
  assert.match(route, /const existing = await findSubmission\(submission\.id\)/);
  assert.match(route, /news: stripExternalNewsFields\(mergeNewsPreservingUnknownFields\(existing\?\.news, sanitizeNews\(next\.news\)\)\)/);
  assert.match(route, /existing\.updated_at !== submission\.updatedAt/);
  assert.match(route, /\.update\(values\)\.eq\("id", next\.id\)\.eq\("updated_at", submission\.updatedAt\)/);
  assert.deepEqual([...route.matchAll(/\.from\("([^"]+)"\)/g)].map((match) => match[1]), ["submissions", "submissions", "submissions"]);
  assert.doesNotMatch(route, /\.storage\b|\.rpc\(|\.(?:delete|upsert)\(|news_schedule_ranges|monthly_digest_orders/);
});

test("FALLBACK-COMPAT-02 actual parse/sanitize/merge keeps known edits and leaves caller inputs unchanged", () => {
  const existing = existingNews(), request = submission();
  const beforeExisting = clone(existing), beforeRequest = clone(request);
  const saved = payload(existing, request);
  assert.equal(saved[0].title, request.news[0].title);
  assert.equal(saved[0].description, request.news[0].description);
  assert.equal(saved[0].images[0].caption, request.news[0].images[0].caption);
  assert.deepEqual(existing, beforeExisting);
  assert.deepEqual(request, beforeRequest);
});

test("FALLBACK-COMPAT-03 future news fields come from trusted existing raw, never client replacements", () => {
  const existing = existingNews(), request = submission();
  request.news[0].futureNews = { opaque: "untrusted replacement" };
  assert.equal(parseSubmission(request).news[0].futureNews, undefined);
  assert.deepEqual(payload(existing, request)[0].futureNews, existing[0].futureNews);
});

test("FALLBACK-COMPAT-04 future image fields and photo paths survive actual photo sanitizer", () => {
  const existing = existingNews(), request = submission();
  request.news[0].images[0].futureImage = { altText: "untrusted replacement" };
  request.news[0].images[0].url = "https://example.invalid/client-preview";
  request.news[0].images[0].originalUrl = "https://example.invalid/client-original";
  const parsedImages = sanitizeNews(parseSubmission(request).news)[0].images;
  assert.equal(Object.hasOwn(parsedImages[0], "url"), false);
  assert.equal(Object.hasOwn(parsedImages[0], "originalUrl"), false);
  assert.equal(Object.hasOwn(parsedImages[0], "futureImage"), false);
  const saved = payload(existing, request)[0].images[0];
  assert.deepEqual(saved.futureImage, existing[0].images[0].futureImage);
  assert.equal(saved.originalPath, "originals/qa.jpg");
  assert.equal(saved.previewPath, "previews/qa.jpg");
  assert.equal(Object.hasOwn(saved, "url"), false);
  assert.equal(Object.hasOwn(saved, "originalUrl"), false);
});

test("FALLBACK-COMPAT-05 future extra-field data survives while known label/value edits apply", () => {
  const existing = existingNews(), request = submission();
  request.news[0].extraFields[0].futureExtra = { format: "untrusted" };
  const saved = payload(existing, request)[0].extraFields[0];
  assert.deepEqual(saved.futureExtra, existing[0].extraFields[0].futureExtra);
  assert.equal(saved.value, "수정 내용");
});

test("FALLBACK-COMPAT-06 future link data survives while known label/url edits apply", () => {
  const existing = existingNews(), request = submission();
  request.news[0].links[0].futureLink = { tracking: "untrusted" };
  const saved = payload(existing, request)[0].links[0];
  assert.deepEqual(saved.futureLink, existing[0].links[0].futureLink);
  assert.equal(saved.url, request.news[0].links[0].url);
});

test("FALLBACK-COMPAT-07 unknown fields on entirely new requested entities are not persisted", () => {
  const request = submission(), news = request.news[0];
  news.futureNews = "untrusted";
  news.images[0].futureImage = "untrusted";
  news.extraFields[0].futureExtra = "untrusted";
  news.links[0].futureLink = "untrusted";
  const saved = payload([], request)[0];
  assert.equal(Object.hasOwn(saved, "futureNews"), false);
  assert.equal(Object.hasOwn(saved.images[0], "futureImage"), false);
  assert.equal(Object.hasOwn(saved.extraFields[0], "futureExtra"), false);
  assert.equal(Object.hasOwn(saved.links[0], "futureLink"), false);
});

test("FALLBACK-COMPAT-08 deletion and order follow requested IDs without resurrecting old entities", () => {
  const existing = existingNews();
  existing.push({ ...clone(existing[0]), id: 102, futureNews: { opaque: "second" } });
  existing[0].images.push({ ...clone(existing[0].images[0]), id: 402, futureImage: "second image" });
  const request = submission();
  request.news = [clone(submission().news[0]), clone(submission().news[0])];
  request.news[0].id = 102;
  request.news[1].images = [clone(existing[0].images[1]), request.news[1].images[0]];
  const reordered = payload(existing, request);
  assert.deepEqual(reordered[1].images.map((item) => item.id), [402, 401]);
  assert.equal(reordered[1].images[0].futureImage, "second image");
  assert.deepEqual(reordered[1].images[1].futureImage, existing[0].images[0].futureImage);
  request.news[1].images = [];
  request.news[1].extraFields = [];
  request.news[1].links = [];
  const saved = payload(existing, request);
  assert.deepEqual(saved.map((item) => item.id), [102, 101]);
  assert.deepEqual(saved[0].futureNews, { opaque: "second" });
  assert.deepEqual(saved[1].images, []);
  assert.deepEqual(saved[1].extraFields, []);
  assert.deepEqual(saved[1].links, []);
  request.news = [request.news[0]];
  assert.deepEqual(payload(existing, request).map((item) => item.id), [102]);
  request.news = [];
  assert.deepEqual(payload(existing, request), []);
});

test("FALLBACK-COMPAT-09 synthetic JSON payload roundtrip preserves future data and strips external range key", () => {
  const existing = existingNews(), request = submission();
  existing[0].scheduleRange = { startDate: "2026-06-17", endDate: "2026-06-30" };
  request.news[0].scheduleRange = null;
  const before = clone(existing);
  const first = clone(payload(existing, request));
  assert.equal(Object.hasOwn(first[0], "scheduleRange"), false);
  const secondRequest = submission();
  secondRequest.news[0].title = "두 번째 저장";
  const second = clone(payload(first, secondRequest));
  assert.equal(second[0].title, "두 번째 저장");
  assert.deepEqual(second[0].futureNews, before[0].futureNews);
  assert.deepEqual(second[0].images[0].futureImage, before[0].images[0].futureImage);
  assert.deepEqual(second[0].extraFields[0].futureExtra, before[0].extraFields[0].futureExtra);
  assert.deepEqual(second[0].links[0].futureLink, before[0].links[0].futureLink);
  assert.deepEqual(existing, before);
  // No real update, readback, side-table or Storage operation is performed.
});

test("FALLBACK-COMPAT-10 known-field validation remains strict rather than accepting unknown request objects", () => {
  const invalidPath = submission();
  invalidPath.news[0].images[0].originalPath = "../not-an-original.jpg";
  assert.throws(() => payload(existingNews(), invalidPath), /원본 사진 경로/);
  const invalidUrl = submission();
  invalidUrl.news[0].links[0].url = "javascript:alert(1)";
  assert.throws(() => payload(existingNews(), invalidUrl), /http/);
  const invalidArray = submission();
  invalidArray.news[0].images = {};
  assert.throws(() => payload(existingNews(), invalidArray), /사진 개수/);
});
