import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSubmissionContentMatches,
  buildCompletedSubmission,
} from "../lib/submission-completion.ts";

function submission(overrides = {}) {
  return {
    id: 456,
    bookstoreId: 123,
    month: "2026-07",
    status: "draft",
    updatedAt: "2026-09-07T00:00:00.000Z",
    completedAt: "",
    publishedAt: "",
    publishedUrl: "",
    monthlyNotice: "이번 달 운영 안내",
    news: [{
      id: 789,
      title: "신규모집",
      description: "마지막 한글까지 저장합니다.",
      dates: [],
      scheduleText: "",
      regular: false,
      displayLabel: "신규 모집",
      deadline: "",
      place: "",
      fee: "",
      applicationInfo: "문의 후 신청",
      applyUrl: "",
      extraFields: [{ id: 1, label: "대상", value: "누구나" }],
      links: [],
      images: [],
      includeInDigest: true,
    }],
    ...overrides,
  };
}

test("builds completion from the latest ref snapshot instead of a stale render", () => {
  const latest = submission();
  const staleRender = submission({
    news: [{ ...latest.news[0], title: "신규모" }],
  });

  const completed = buildCompletedSubmission(
    [latest],
    staleRender.bookstoreId,
    staleRender.month,
    "2026-09-07T01:00:00.000Z",
  );

  assert.equal(completed.news[0].title, "신규모집");
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAt, "2026-09-07T01:00:00.000Z");
});

test("rejects a save response that lost the final Korean characters", () => {
  const requested = submission({ status: "completed" });
  const truncated = submission({
    status: "completed",
    updatedAt: "2026-09-07T01:00:01.000Z",
    news: [{ ...requested.news[0], title: "신규모" }],
  });

  assert.throws(
    () => assertSubmissionContentMatches(requested, truncated),
    /마지막 입력 내용과 서버에 저장된 내용이 일치하지 않습니다/,
  );
});

test("verifies title, detail, and optional fields while ignoring server-only image URLs", () => {
  const requested = submission({
    status: "completed",
    completedAt: "2026-09-07T01:00:00.000Z",
    news: [{
      ...submission().news[0],
      images: [{
        id: 900,
        name: "poster.jpg",
        originalPath: "originals/poster.jpg",
        previewPath: "previews/poster.jpg",
        originalUrl: "",
        url: "https://old-preview.example/poster.jpg",
        caption: "포스터",
      }],
    }],
  });
  const saved = {
    ...requested,
    updatedAt: "2026-09-07T01:00:01.000Z",
    completedAt: "2026-09-07T01:00:00+00:00",
    news: [{
      ...requested.news[0],
      images: [{
        ...requested.news[0].images[0],
        originalUrl: "/api/images?path=originals%2Fposter.jpg",
        url: "https://new-preview.example/poster.jpg",
      }],
    }],
  };

  assert.doesNotThrow(() => assertSubmissionContentMatches(requested, saved));
  assert.throws(
    () => assertSubmissionContentMatches(requested, {
      ...saved,
      news: [{ ...saved.news[0], applicationInfo: "문의 후 신" }],
    }),
    /일치하지 않습니다/,
  );
});

test("treats canonically equivalent Korean text as the same saved content", () => {
  const requested = submission({ monthlyNotice: "소식".normalize("NFD") });
  const saved = { ...requested, updatedAt: "2026-09-07T01:00:01.000Z", monthlyNotice: "소식".normalize("NFC") };
  assert.doesNotThrow(() => assertSubmissionContentMatches(requested, saved));
});

test("ignores JSONB object key ordering while preserving saved content", () => {
  const requested = submission({ status: "completed" });
  const news = requested.news[0];
  const saved = {
    publishedUrl: requested.publishedUrl,
    news: [{
      includeInDigest: news.includeInDigest,
      images: news.images,
      links: news.links,
      extraFields: news.extraFields.map((field) => ({
        value: field.value,
        label: field.label,
        id: field.id,
      })),
      applyUrl: news.applyUrl,
      applicationInfo: news.applicationInfo,
      fee: news.fee,
      place: news.place,
      deadline: news.deadline,
      displayLabel: news.displayLabel,
      regular: news.regular,
      scheduleText: news.scheduleText,
      dates: news.dates,
      description: news.description,
      title: news.title,
      id: news.id,
    }],
    monthlyNotice: requested.monthlyNotice,
    publishedAt: requested.publishedAt,
    completedAt: requested.completedAt,
    updatedAt: "2026-09-07T01:00:01.000Z",
    status: requested.status,
    month: requested.month,
    bookstoreId: requested.bookstoreId,
    id: requested.id,
  };

  assert.doesNotThrow(() => assertSubmissionContentMatches(requested, saved));
});
