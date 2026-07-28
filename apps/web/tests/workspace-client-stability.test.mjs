import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeImageFile,
  persistBookstore,
  StorageUploadError,
  uploadFileToSignedUrl,
  WorkspaceConflictError,
} from "../lib/workspace-client.ts";
import {
  forgetSubmissionDraft,
  recoverSubmissionDraft,
  rememberSubmissionDraft,
} from "../lib/submission-draft.ts";
import {
  rebaseSubmissionSnapshot,
  restoreSubmissionFromBaseline,
} from "../lib/workspace-persistence.ts";
import { retryFutureJwt } from "../lib/supabase-server.ts";

function installBrowserStub() {
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: { getItem: () => "stability-test-session" },
    setTimeout: (callback) => globalThis.setTimeout(callback, 0),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  };
  return () => {
    globalThis.window = previousWindow;
  };
}

function submission(overrides = {}) {
  return {
    id: 456,
    bookstoreId: 123,
    month: "2026-07",
    status: "draft",
    updatedAt: "",
    completedAt: "",
    publishedAt: "",
    publishedUrl: "",
    monthlyNotice: "",
    news: [{
      id: 789,
      title: "복구 테스트 소식",
      description: "뒤로가도 사라지지 않아야 합니다.",
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
    }],
    ...overrides,
  };
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function bookstore(overrides = {}) {
  return {
    id: 123,
    updatedAt: "2026-07-27T00:00:00.000Z",
    sortOrder: 0,
    name: "안정화 테스트 책방",
    region: "울산 남구",
    address: "",
    hours: "",
    phone: "",
    sns: "",
    website: "",
    introduction: "",
    contacts: [],
    links: [],
    ...overrides,
  };
}

test("recovers a save when a transient 500 is followed by the already-saved record", async () => {
  const restoreWindow = installBrowserStub();
  const previousFetch = globalThis.fetch;
  const requested = bookstore();
  const latest = bookstore({ updatedAt: "2026-07-27T00:00:01.000Z" });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ error: "temporary" }, { status: 500 });
    return Response.json({
      error: "stale",
      code: "WORKSPACE_CONFLICT",
      latest,
    }, { status: 409 });
  };

  try {
    assert.deepEqual(await persistBookstore(requested), latest);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("keeps a real concurrent edit as a conflict instead of overwriting it", async () => {
  const restoreWindow = installBrowserStub();
  const previousFetch = globalThis.fetch;
  const requested = bookstore();
  globalThis.fetch = async () => Response.json({
    error: "another worker saved first",
    code: "WORKSPACE_CONFLICT",
    latest: bookstore({ updatedAt: "2026-07-27T00:00:01.000Z", address: "다른 작업자의 주소" }),
  }, { status: 409 });

  try {
    await assert.rejects(() => persistBookstore(requested), WorkspaceConflictError);
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("recognizes HEIC files with an empty Windows MIME type", () => {
  const file = new File([new Uint8Array([0, 1, 2])], "IMG_0200.HEIC", { type: "" });
  const normalized = normalizeImageFile(file);
  assert.ok(normalized);
  assert.equal(normalized.type, "image/heic");
  assert.equal(normalized.name, file.name);
});

test("uses the HEIC extension when a browser reports a sequence MIME type", () => {
  const file = new File([new Uint8Array([0, 1, 2])], "IMG_0201.HEIC", { type: "image/heic-sequence" });
  const normalized = normalizeImageFile(file);
  assert.ok(normalized);
  assert.equal(normalized.type, "image/heic");
});

test("retries a transient signed Storage PUT without changing the file", async () => {
  const restoreWindow = installBrowserStub();
  const previousFetch = globalThis.fetch;
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "poster.jpg", { type: "image/jpeg" });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response("temporary", { status: 503 }) : new Response(null, { status: 200 });
  };

  try {
    await uploadFileToSignedUrl("https://storage.example.test/signed", file, "300");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("asks the caller for a fresh signed URL after repeated network failures", async () => {
  const restoreWindow = installBrowserStub();
  const previousFetch = globalThis.fetch;
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "poster.jpg", { type: "image/jpeg" });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("network disconnected");
  };

  try {
    await assert.rejects(
      () => uploadFileToSignedUrl("https://storage.example.test/signed", file, "300"),
      (error) => error instanceof StorageUploadError && error.retryableWithNewReservation,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("recovers a same-tab draft but never overwrites a newer server version", () => {
  const storage = new MemoryStorage();
  const unsaved = submission({ id: 111 });
  rememberSubmissionDraft(unsaved, storage);

  // 새로고침 뒤 만들어진 임시 ID가 달라도 아직 서버에 없는 같은 월·책방의 내용은 복구합니다.
  assert.deepEqual(recoverSubmissionDraft(submission({ id: 222 }), storage), unsaved);

  const saved = submission({ id: 333, updatedAt: "2026-07-27T01:00:00.000Z" });
  rememberSubmissionDraft(saved, storage);
  assert.deepEqual(recoverSubmissionDraft(saved, storage), saved);
  assert.equal(
    recoverSubmissionDraft({ ...saved, updatedAt: "2026-07-27T01:01:00.000Z" }, storage),
    null,
  );

  rememberSubmissionDraft(saved, storage);
  forgetSubmissionDraft(saved, storage);
  assert.equal(recoverSubmissionDraft(saved, storage), null);
});

test("rebases a leave snapshot onto a queued autosave version without changing its text", () => {
  const leaving = submission({
    updatedAt: "2026-07-27T01:00:00.000Z",
    news: [{ ...submission().news[0], title: "마지막 화면 입력" }],
  });
  const afterQueuedSave = submission({
    updatedAt: "2026-07-27T01:01:00.000Z",
    news: [{ ...submission().news[0], title: "이전 자동 저장 내용" }],
  });
  const rebased = rebaseSubmissionSnapshot(leaving, afterQueuedSave);
  assert.equal(rebased.updatedAt, afterQueuedSave.updatedAt);
  assert.equal(rebased.news[0].title, "마지막 화면 입력");
});

test("restores the last server baseline or removes a never-saved draft when leaving without saving", () => {
  const baseline = submission({
    updatedAt: "2026-07-27T01:00:00.000Z",
    news: [{ ...submission().news[0], title: "마지막 자동 저장 내용" }],
  });
  const changed = {
    ...baseline,
    news: [{ ...baseline.news[0], title: "아직 저장하지 않은 내용" }],
  };
  assert.deepEqual(
    restoreSubmissionFromBaseline([changed], changed.id, baseline),
    [baseline],
  );
  assert.deepEqual(
    restoreSubmissionFromBaseline([changed], changed.id),
    [],
  );
});

test("retries only the Supabase future-JWT clock-skew error", async () => {
  let calls = 0;
  const recovered = await retryFutureJwt(async () => {
    calls += 1;
    return calls === 1
      ? { data: null, error: { code: "PGRST303", message: "JWT issued at future" } }
      : { data: "ready", error: null };
  }, { delayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(recovered.data, "ready");

  let ordinaryCalls = 0;
  const ordinaryFailure = await retryFutureJwt(async () => {
    ordinaryCalls += 1;
    return { data: null, error: { code: "PGRST301", message: "invalid token" } };
  }, { delayMs: 0 });
  assert.equal(ordinaryCalls, 1);
  assert.equal(ordinaryFailure.error.code, "PGRST301");
});
