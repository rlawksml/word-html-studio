import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findBlockingSubmissionUrl,
  findInvalidSubmissionUrl,
  isValidHttpUrl,
  normalizeHttpUrlInput,
  normalizeSubmissionUrls,
} from "../lib/submission-url-validation.ts";
import { safeClientHref } from "../lib/workspace-formatters.ts";

function news(id, overrides = {}) {
  return {
    id,
    title: `테스트 소식 ${id}`,
    description: "상세 내용",
    dates: [],
    scheduleText: "",
    regular: false,
    displayLabel: "",
    deadline: "",
    place: "",
    fee: "",
    applicationInfo: "",
    applyUrl: "",
    extraFields: [],
    links: [],
    images: [],
    includeInDigest: true,
    ...overrides,
  };
}

function submission(count = 1, overrides = {}) {
  return {
    id: 100,
    bookstoreId: 200,
    month: "2026-09",
    status: "draft",
    updatedAt: "",
    completedAt: "",
    publishedAt: "",
    publishedUrl: "",
    monthlyNotice: "",
    news: Array.from({ length: count }, (_, index) => news(index + 1)),
    ...overrides,
  };
}

test("부분 URL은 draft 자동 저장을 막지 않고 completed에서만 차단한다", () => {
  const draft = submission(1, {
    news: [news(1, { applyUrl: "https:/" })],
  });
  assert.equal(findBlockingSubmissionUrl(draft), null);

  const completed = { ...draft, status: "completed" };
  assert.deepEqual(findBlockingSubmissionUrl(completed), {
    code: "INVALID_URL",
    fieldPath: "news.0.applyUrl",
    fieldLabel: "소식 1 → 대표 신청 링크",
    message: "소식 1 → 대표 신청 링크에 http:// 또는 https://로 시작하는 주소를 입력해 주세요.",
  });
});

test("www 주소는 https로 보완하고 올바른 http/https 주소는 유지한다", () => {
  assert.equal(normalizeHttpUrlInput("www.example.com/path"), "https://www.example.com/path");
  assert.equal(normalizeHttpUrlInput("example.com"), "https://example.com");
  assert.equal(normalizeHttpUrlInput("https://example.com/path"), "https://example.com/path");
  assert.equal(normalizeHttpUrlInput("https:/"), "https:/");
  assert.equal(isValidHttpUrl("https://example.com"), true);
  assert.equal(isValidHttpUrl("http://example.com"), true);
  assert.equal(isValidHttpUrl("https:/"), false);
});

test("입력 완료 전 URL 보완은 소식과 링크의 다른 내용을 바꾸지 않는다", () => {
  const original = submission(1, {
    news: [news(1, {
      title: "원문 보존",
      applyUrl: "www.example.com/apply",
      links: [{ id: 10, label: "안내", url: "example.org/info" }],
    })],
  });
  const normalized = normalizeSubmissionUrls(original);
  assert.equal(normalized.news[0].title, "원문 보존");
  assert.equal(normalized.news[0].applyUrl, "https://www.example.com/apply");
  assert.equal(normalized.news[0].links[0].url, "https://example.org/info");
  assert.equal(original.news[0].applyUrl, "www.example.com/apply");
});

test("1·5·10·20개 소식에서 첫 잘못된 관련 링크의 정확한 위치를 찾는다", () => {
  for (const count of [1, 5, 10, 20]) {
    const items = Array.from({ length: count }, (_, index) => news(index + 1, {
      applyUrl: "https://example.com/apply",
      links: [{ id: index + 100, label: "정상", url: "https://example.com/info" }],
    }));
    assert.equal(findInvalidSubmissionUrl(submission(count, { news: items })), null);
    items[count - 1] = {
      ...items[count - 1],
      links: [items[count - 1].links[0], { id: count + 500, label: "입력 중", url: "https:/" }],
    };
    const issue = findInvalidSubmissionUrl(submission(count, { news: items }));
    assert.equal(issue?.fieldPath, `news.${count - 1}.links.1.url`);
    assert.match(issue?.message || "", new RegExp(`소식 ${count} → 관련 링크 2`));
  }
});

test("불완전하거나 위험한 URL은 공개 HTML 링크로 렌더링할 수 없다", () => {
  assert.equal(safeClientHref("https:/"), "");
  assert.equal(safeClientHref("javascript:alert(1)"), "");
  assert.equal(safeClientHref("https://example.com/path"), "https://example.com/path");
});

test("Submission API와 입력 UI가 구조화 오류·정확한 필드 포커스를 연결한다", async () => {
  const [route, controller, editor, validation] = await Promise.all([
    readFile(new URL("../app/api/submissions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/use-studio-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/molecules/NewsEditorCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/workspace-validation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /code: error\.code/);
  assert.match(route, /fieldPath: error\.fieldPath/);
  assert.match(route, /requestBytes/);
  assert.doesNotMatch(route, /console\.warn\([^\n]*submission\)/);
  assert.match(validation, /findBlockingSubmissionUrl\(submission\)/);
  assert.match(controller, /data-url-field-path/);
  assert.match(controller, /optionalFields\.open = true/);
  assert.match(controller, /field\?\.focus/);
  assert.match(editor, /data-url-field-path=\{`news\.\$\{index\}\.applyUrl`\}/);
  assert.match(editor, /news\.\$\{index\}\.links\.\$\{linkIndex\}\.url/);
});
