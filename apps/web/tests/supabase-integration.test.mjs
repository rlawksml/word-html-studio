import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  assertRowsAbsent,
  assertStorageObjectAbsent,
  runExactCleanup,
} from "./helpers/supabase-cleanup-guard.mjs";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("integration", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

function runtime() {
  return {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
}

function context() {
  return { waitUntil() {}, passThroughOnException() {} };
}

async function assertStatus(response, expected) {
  if (response.status === expected) return;
  const message = await response.text();
  assert.fail(`expected ${expected}, received ${response.status}: ${message}`);
}

test("persists records, rejects stale writes, and cleans uploaded images", { skip: !enabled }, async () => {
  const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "INPUT_ACCESS_CODES"];
  for (const key of required) assert.ok(process.env[key], `${key} is required`);

  const worker = await loadWorker();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const bookstoreId = Number(suffix.slice(-15));
  const submissionId = bookstoreId + 1;
  const newsId = bookstoreId + 2;
  const sessionId = crypto.randomUUID();
  const secondSessionId = crypto.randomUUID();
  const code = process.env.INPUT_ACCESS_CODES.split(",")[0].trim();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let uploadedImage = null;
  let reservedImage = null;

  const appFetch = (path, init = {}) => worker.fetch(new Request(`http://localhost${path}`, init), runtime(), context());
  const sessionResponse = await appFetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "input", code, sessionId }),
  });
  assert.equal(sessionResponse.status, 200);
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const workerHeaders = { "content-type": "application/json", cookie, "x-workspace-session-id": sessionId };
  const secondSessionResponse = await appFetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "input", code, sessionId: secondSessionId }),
  });
  assert.equal(secondSessionResponse.status, 200);
  const secondCookie = secondSessionResponse.headers.get("set-cookie")?.split(";")[0];
  assert.ok(secondCookie);
  const secondWorkerHeaders = { "content-type": "application/json", cookie: secondCookie, "x-workspace-session-id": secondSessionId };
  const presenceTarget = { scope: "submission", month: "2099-12", bookstoreId };

  try {
    const versionResponse = await appFetch("/api/version");
    await assertStatus(versionResponse, 200);
    const version = await versionResponse.json();
    assert.equal(version.productVersion, "1.1.0-rc.1");
    assert.equal(version.databaseSchemaVersion, 202609070002);
    assert.equal(version.expectedSchemaVersion, 202609070002);
    assert.equal(version.compatible, true);

    const firstLease = await appFetch("/api/presence", { method: "POST", headers: workerHeaders, body: JSON.stringify(presenceTarget) });
    await assertStatus(firstLease, 200);
    assert.equal((await firstLease.json()).owned, true);
    const occupiedLease = await appFetch("/api/presence", { method: "POST", headers: secondWorkerHeaders, body: JSON.stringify(presenceTarget) });
    await assertStatus(occupiedLease, 200);
    const occupiedLeaseBody = await occupiedLease.json();
    assert.equal(occupiedLeaseBody.owned, false);
    assert.equal(occupiedLeaseBody.activeRole, "input");
    assert.ok(Date.parse(occupiedLeaseBody.expiresAt) > Date.now());
    const releaseLease = await appFetch("/api/presence", { method: "DELETE", headers: workerHeaders, body: JSON.stringify(presenceTarget) });
    await assertStatus(releaseLease, 204);
    const handedOffLease = await appFetch("/api/presence", { method: "POST", headers: secondWorkerHeaders, body: JSON.stringify(presenceTarget) });
    await assertStatus(handedOffLease, 200);
    assert.equal((await handedOffLease.json()).owned, true);

    const bookstore = {
      id: bookstoreId, updatedAt: "", sortOrder: 9_999, name: `통합 테스트 책방 ${suffix}`, region: "테스트 지역",
      address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [],
    };
    const createBookstore = await appFetch("/api/bookstores", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ bookstore }) });
    await assertStatus(createBookstore, 200);
    const firstBookstore = (await createBookstore.json()).bookstore;
    assert.ok(firstBookstore.updatedAt);

    const updateBookstore = await appFetch("/api/bookstores", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ bookstore: { ...firstBookstore, introduction: "첫 저장" } }) });
    await assertStatus(updateBookstore, 200);
    const staleBookstore = await appFetch("/api/bookstores", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ bookstore: { ...firstBookstore, introduction: "뒤늦은 저장" } }) });
    assert.equal(staleBookstore.status, 409);
    assert.equal((await staleBookstore.json()).code, "WORKSPACE_CONFLICT");

    const submission = {
      id: submissionId, bookstoreId, month: "2099-12", status: "draft", updatedAt: "", completedAt: "", publishedAt: "", publishedUrl: "", monthlyNotice: "",
      news: [{
        id: newsId, title: "통합 테스트 소식", description: "자동으로 정리되는 테스트 데이터입니다.", dates: ["2099-12-01"], scheduleRange: null, scheduleText: "", regular: false,
        displayLabel: "", deadline: "", place: "", fee: "", applicationInfo: "", applyUrl: "https:/", extraFields: [], links: [], images: [], includeInDigest: true,
      }],
    };
    const createSubmission = await appFetch("/api/submissions", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ submission }) });
    await assertStatus(createSubmission, 200);
    const firstSubmission = (await createSubmission.json()).submission;
    assert.equal(firstSubmission.news[0].applyUrl, "https:/", "draft 자동 저장은 입력 중 URL을 그대로 보존해야 합니다.");
    const updateSubmission = await appFetch("/api/submissions", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ submission: { ...firstSubmission, monthlyNotice: "수정됨" } }) });
    await assertStatus(updateSubmission, 200);
    let updatedSubmission = (await updateSubmission.json()).submission;

    // v1.1 전용 필드와 기간 행을 만든 뒤 v1.0.1 형태의 저장 요청이 이를 지우지 않는지 검증합니다.
    const requestedCompatibilityUpdatedAt = new Date(Date.now() + 1_000).toISOString();
    const futureNews = [{
      ...updatedSubmission.news[0],
      scheduleRangeRef: `range-${newsId}`,
      futureOptions: { calendarMode: "range" },
    }];
    const seedFutureFields = await admin
      .from("submissions")
      .update({ news: futureNews, updated_at: requestedCompatibilityUpdatedAt })
      .eq("id", submissionId)
      .select("updated_at")
      .single();
    assert.equal(seedFutureFields.error, null);
    const compatibilityUpdatedAt = seedFutureFields.data.updated_at;
    const seedScheduleRange = await admin.from("news_schedule_ranges").insert({
      submission_id: submissionId,
      news_item_id: newsId,
      start_date: "2099-12-01",
      end_date: "2100-01-31",
    });
    assert.equal(seedScheduleRange.error, null);

    const oldClientNews = { ...updatedSubmission.news[0] };
    delete oldClientNews.scheduleRange;
    const oldAppSave = await appFetch("/api/submissions", {
      method: "PUT",
      headers: workerHeaders,
      body: JSON.stringify({
        submission: {
          ...updatedSubmission,
          updatedAt: compatibilityUpdatedAt,
          monthlyNotice: "v1.0.1에서 기존 필드만 수정",
          news: [oldClientNews],
        },
      }),
    });
    await assertStatus(oldAppSave, 200);
    updatedSubmission = (await oldAppSave.json()).submission;
    const compatibilityRow = await admin.from("submissions").select("news").eq("id", submissionId).single();
    assert.equal(compatibilityRow.error, null);
    assert.equal(compatibilityRow.data.news[0].scheduleRangeRef, `range-${newsId}`);
    assert.deepEqual(compatibilityRow.data.news[0].futureOptions, { calendarMode: "range" });
    const preservedScheduleRange = await admin
      .from("news_schedule_ranges")
      .select("start_date,end_date")
      .eq("submission_id", submissionId)
      .eq("news_item_id", newsId)
      .single();
    assert.equal(preservedScheduleRange.error, null);
    assert.deepEqual(preservedScheduleRange.data, { start_date: "2099-12-01", end_date: "2100-01-31" });

    const beforeInvalidRangeUpdatedAt = updatedSubmission.updatedAt;
    const invalidRangeSave = await appFetch("/api/submissions", {
      method: "PUT",
      headers: workerHeaders,
      body: JSON.stringify({
        submission: {
          ...updatedSubmission,
          news: [{ ...updatedSubmission.news[0], dates: [], scheduleRange: { startDate: "2100-02-01", endDate: "2100-01-31" } }],
        },
      }),
    });
    assert.equal(invalidRangeSave.status, 400);
    const invalidRangeBody = await invalidRangeSave.json();
    assert.equal(invalidRangeBody.code, "INVALID_SCHEDULE_RANGE");
    assert.equal(invalidRangeBody.fieldPath, "news.0.scheduleRange.endDate");
    const afterInvalidRange = await admin.from("submissions").select("updated_at").eq("id", submissionId).single();
    assert.equal(afterInvalidRange.error, null);
    assert.equal(afterInvalidRange.data.updated_at, beforeInvalidRangeUpdatedAt, "잘못된 기간은 본문도 갱신하지 않아야 합니다.");

    const validScheduleRange = { startDate: "2099-12-17", endDate: "2100-02-12" };
    const rangeSave = await appFetch("/api/submissions", {
      method: "PUT",
      headers: workerHeaders,
      body: JSON.stringify({
        submission: {
          ...updatedSubmission,
          news: [{ ...updatedSubmission.news[0], dates: [], scheduleRange: validScheduleRange }],
        },
      }),
    });
    await assertStatus(rangeSave, 200);
    updatedSubmission = (await rangeSave.json()).submission;
    assert.deepEqual(updatedSubmission.news[0].scheduleRange, validScheduleRange);
    assert.deepEqual(updatedSubmission.news[0].dates, []);
    const storedRange = await admin.from("news_schedule_ranges").select("start_date,end_date,is_active").eq("submission_id", submissionId).eq("news_item_id", newsId).single();
    assert.equal(storedRange.error, null);
    assert.deepEqual(storedRange.data, { start_date: "2099-12-17", end_date: "2100-02-12", is_active: true });
    const storedNews = await admin.from("submissions").select("news").eq("id", submissionId).single();
    assert.equal(storedNews.error, null);
    assert.equal(Object.prototype.hasOwnProperty.call(storedNews.data.news[0], "scheduleRange"), false, "기간은 롤백 호환 JSONB에 섞이면 안 됩니다.");
    const publicWorkspace = await appFetch("/api/workspace");
    await assertStatus(publicWorkspace, 200);
    const publicSubmission = (await publicWorkspace.json()).submissions.find((item) => item.id === submissionId);
    assert.deepEqual(publicSubmission.news[0].scheduleRange, validScheduleRange);
    const invalidCompletion = await appFetch("/api/submissions", {
      method: "PUT",
      headers: workerHeaders,
      body: JSON.stringify({ submission: { ...updatedSubmission, status: "completed", completedAt: new Date().toISOString() } }),
    });
    assert.equal(invalidCompletion.status, 400);
    const invalidCompletionBody = await invalidCompletion.json();
    assert.equal(invalidCompletionBody.code, "INVALID_URL");
    assert.equal(invalidCompletionBody.fieldPath, "news.0.applyUrl");
    assert.match(invalidCompletionBody.message, /소식 1 → 대표 신청 링크/);
    const completionRequest = {
      ...updatedSubmission,
      status: "completed",
      completedAt: new Date().toISOString(),
      news: [{
        ...updatedSubmission.news[0],
        title: "신규모집",
        description: "상세 내용의 마지막 한글도 보존합니다.",
        applicationInfo: "문의 후 신청",
        applyUrl: "https://example.com/apply",
        extraFields: [{ id: newsId + 1, label: "대상", value: "누구나" }],
      }],
    };
    const completeSubmission = await appFetch("/api/submissions", {
      method: "PUT",
      headers: workerHeaders,
      body: JSON.stringify({ submission: completionRequest }),
    });
    await assertStatus(completeSubmission, 200);
    const completedSubmission = (await completeSubmission.json()).submission;
    assert.equal(completedSubmission.status, "completed");
    assert.equal(completedSubmission.news[0].title, "신규모집");
    assert.equal(completedSubmission.news[0].description, "상세 내용의 마지막 한글도 보존합니다.");
    assert.equal(completedSubmission.news[0].applicationInfo, "문의 후 신청");
    assert.deepEqual(completedSubmission.news[0].extraFields, completionRequest.news[0].extraFields);
    const staleSubmission = await appFetch("/api/submissions", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ submission: { ...firstSubmission, monthlyNotice: "뒤늦은 저장" } }) });
    assert.equal(staleSubmission.status, 409);

    const originalDisplayName = "수연목서 1(최종).jpg";
    const reserve = await appFetch("/api/images", {
      method: "POST", headers: workerHeaders,
      body: JSON.stringify({ name: originalDisplayName, type: "image/jpeg", size: 4, previewSize: 4, month: "2099-12", bookstoreId, newsId }),
    });
    await assertStatus(reserve, 201);
    const reservation = await reserve.json();
    uploadedImage = reservation.image;
    reservedImage = reservation.image;
    assert.equal(uploadedImage.name, originalDisplayName);
    assert.match(uploadedImage.originalPath, /^originals\/2099-12\/\d+\/\d+\/[0-9a-f-]+\.jpg$/);
    assert.doesNotMatch(uploadedImage.originalPath, /[^\x00-\x7F]/);
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], originalDisplayName, { type: "image/jpeg" });
    for (const signedUrl of [reservation.uploads.originalUrl, reservation.uploads.previewUrl]) {
      const form = new FormData();
      form.append("cacheControl", "60");
      form.append("", jpeg);
      const upload = await fetch(signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: form });
      assert.ok(upload.ok, `signed upload failed: ${upload.status}`);
    }
    const remove = await appFetch("/api/images", { method: "DELETE", headers: workerHeaders, body: JSON.stringify({ images: [uploadedImage] }) });
    await assertStatus(remove, 204);
    uploadedImage = null;
  } finally {
    const storageCleanup = uploadedImage ? [
      {
        label: "원본 사진 삭제",
        run: () => admin.storage.from("bookstore-news-originals").remove([uploadedImage.originalPath]),
      },
      {
        label: "미리보기 사진 삭제",
        run: () => admin.storage.from("bookstore-news-previews").remove([uploadedImage.previewPath]),
      },
    ] : [];
    const storageVerification = reservedImage ? [
      {
        label: "원본 사진 잔여 확인",
        run: () => assertStorageObjectAbsent(admin.storage.from("bookstore-news-originals"), reservedImage.originalPath, "원본 사진"),
      },
      {
        label: "미리보기 사진 잔여 확인",
        run: () => assertStorageObjectAbsent(admin.storage.from("bookstore-news-previews"), reservedImage.previewPath, "미리보기 사진"),
      },
    ] : [];

    await runExactCleanup([
      ...storageCleanup,
      { label: "기간 일정 삭제", run: () => admin.from("news_schedule_ranges").delete().eq("submission_id", submissionId).eq("news_item_id", newsId) },
      { label: "소식 제출 삭제", run: () => admin.from("submissions").delete().eq("id", submissionId) },
      { label: "책방 삭제", run: () => admin.from("bookstores").delete().eq("id", bookstoreId) },
      { label: "편집 임대 삭제", run: () => admin.from("editing_leases").delete().eq("resource_key", `submission:2099-12:${bookstoreId}`) },
      ...storageVerification,
      {
        label: "기간 일정 잔여 확인",
        run: () => assertRowsAbsent(admin.from("news_schedule_ranges").select("id").eq("submission_id", submissionId).eq("news_item_id", newsId), "기간 일정"),
      },
      {
        label: "소식 제출 잔여 확인",
        run: () => assertRowsAbsent(admin.from("submissions").select("id").eq("id", submissionId), "소식 제출"),
      },
      {
        label: "책방 잔여 확인",
        run: () => assertRowsAbsent(admin.from("bookstores").select("id").eq("id", bookstoreId), "책방"),
      },
      {
        label: "편집 임대 잔여 확인",
        run: () => assertRowsAbsent(admin.from("editing_leases").select("resource_key").eq("resource_key", `submission:2099-12:${bookstoreId}`), "편집 임대"),
      },
    ]);
  }
});

test("rejects unauthorized operations and safely hands off exceptional editing leases", { skip: !enabled }, async () => {
  const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "INPUT_ACCESS_CODES", "HTML_ACCESS_CODES"];
  for (const key of required) assert.ok(process.env[key], `${key} is required`);

  const worker = await loadWorker();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const appFetch = (path, init = {}) => worker.fetch(new Request(`http://localhost${path}`, init), runtime(), context());
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
  const bookstoreId = Number(suffix.slice(-15));
  const target = { scope: "submission", month: "2099-11", bookstoreId };
  const digestTarget = { scope: "digest", month: "2099-11" };

  const login = async (role, code) => {
    const sessionId = crypto.randomUUID();
    const response = await appFetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, code, sessionId }),
    });
    await assertStatus(response, 200);
    return {
      sessionId,
      headers: { "content-type": "application/json", cookie: response.headers.get("set-cookie").split(";")[0], "x-workspace-session-id": sessionId },
    };
  };

  const input = await login("input", process.env.INPUT_ACCESS_CODES.split(",")[0].trim());
  const html = await login("html", process.env.HTML_ACCESS_CODES.split(",")[0].trim());

  try {
    await assertStatus(await appFetch("/api/workspace"), 200);
    await assertStatus(await appFetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target) }), 401);
    await assertStatus(await appFetch("/api/bookstores", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }), 403);
    await assertStatus(await appFetch("/api/presence", { method: "POST", headers: { ...input.headers, "x-workspace-session-id": html.sessionId }, body: JSON.stringify(target) }), 401);
    await assertStatus(await appFetch("/api/presence", { method: "POST", headers: input.headers, body: JSON.stringify({ ...target, month: "2099-13" }) }), 400);

    const firstLease = await appFetch("/api/presence", { method: "POST", headers: input.headers, body: JSON.stringify(target) });
    await assertStatus(firstLease, 200);
    assert.equal((await firstLease.json()).owned, true);

    const nonOwnerRelease = await appFetch("/api/presence", { method: "DELETE", headers: html.headers, body: JSON.stringify(target) });
    await assertStatus(nonOwnerRelease, 204);
    const stillOwned = await appFetch("/api/presence", { method: "POST", headers: input.headers, body: JSON.stringify(target) });
    assert.equal((await stillOwned.json()).owned, true);
    const stillOccupied = await appFetch("/api/presence", { method: "POST", headers: html.headers, body: JSON.stringify(target) });
    assert.equal((await stillOccupied.json()).owned, false);

    const separateDigest = await appFetch("/api/presence", { method: "POST", headers: html.headers, body: JSON.stringify(digestTarget) });
    await assertStatus(separateDigest, 200);
    assert.equal((await separateDigest.json()).owned, true);

    await admin.from("editing_leases").update({ expires_at: new Date(Date.now() - 1_000).toISOString() }).eq("resource_key", `submission:2099-11:${bookstoreId}`);
    const expiredHandoff = await appFetch("/api/presence", { method: "POST", headers: html.headers, body: JSON.stringify(target) });
    await assertStatus(expiredHandoff, 200);
    assert.equal((await expiredHandoff.json()).owned, true);

    await assertStatus(await appFetch("/api/bookstores", { method: "PUT", headers: html.headers, body: JSON.stringify({}) }), 403);
    await assertStatus(await appFetch("/api/images", {
      method: "POST", headers: input.headers,
      body: JSON.stringify({ name: "document.pdf", type: "application/pdf", size: 100, previewSize: 100, month: "2099-11", bookstoreId, newsId: bookstoreId + 1 }),
    }), 400);
    await assertStatus(await appFetch("/api/images", {
      method: "POST", headers: input.headers,
      body: JSON.stringify({ name: "large.jpg", type: "image/jpeg", size: 20 * 1024 * 1024 + 1, previewSize: 100, month: "2099-11", bookstoreId, newsId: bookstoreId + 1 }),
    }), 413);
  } finally {
    const resourceKeys = [`submission:2099-11:${bookstoreId}`, "digest:2099-11"];
    await runExactCleanup([
      { label: "예외 편집 임대 삭제", run: () => admin.from("editing_leases").delete().in("resource_key", resourceKeys) },
      {
        label: "예외 편집 임대 잔여 확인",
        run: () => assertRowsAbsent(admin.from("editing_leases").select("resource_key").in("resource_key", resourceKeys), "예외 편집 임대"),
      },
    ]);
  }
});

test("accepts public improvements and protects workflow status updates", { skip: !enabled }, async () => {
  const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "INPUT_ACCESS_CODES", "HTML_ACCESS_CODES"];
  for (const key of required) assert.ok(process.env[key], `${key} is required`);

  const worker = await loadWorker();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const appFetch = (path, init = {}) => worker.fetch(new Request(`http://localhost${path}`, init), runtime(), context());
  const loginRole = async (role, code) => {
    const sessionId = crypto.randomUUID();
    const login = await appFetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, code, sessionId }),
    });
    await assertStatus(login, 200);
    return {
      "content-type": "application/json",
      cookie: login.headers.get("set-cookie").split(";")[0],
      "x-workspace-session-id": sessionId,
    };
  };
  const inputHeaders = await loginRole("input", process.env.INPUT_ACCESS_CODES.split(",")[0].trim());
  const htmlHeaders = await loginRole("html", process.env.HTML_ACCESS_CODES.split(",")[0].trim());
  let improvementId = "";

  try {
    const invalid = await appFetch("/api/improvements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestType: "improvement", title: "개선 제목", content: "개선 내용입니다.", reason: "", website: "" }),
    });
    assert.equal(invalid.status, 400);

    const create = await appFetch("/api/improvements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestType: "bug",
        title: `통합 테스트 버그 ${Date.now()}`,
        location: "소식 입력 → 사진 첨부",
        content: "공개 접수와 HTML 편집자 상태 변경을 확인한 뒤 자동으로 삭제합니다.",
        reason: "",
        website: "",
      }),
    });
    await assertStatus(create, 201);
    const created = (await create.json()).improvement;
    improvementId = created.id;
    assert.equal(created.requestType, "bug");
    assert.equal(created.location, "소식 입력 → 사진 첨부");
    assert.equal(created.status, "received");

    const publicList = await appFetch("/api/improvements");
    await assertStatus(publicList, 200);
    const publicBody = await publicList.json();
    assert.equal(publicBody.canManage, false);
    assert.ok(publicBody.improvements.some((item) => item.id === improvementId));

    const inputList = await appFetch("/api/improvements", { headers: inputHeaders });
    await assertStatus(inputList, 200);
    assert.equal((await inputList.json()).canManage, false);

    const htmlList = await appFetch("/api/improvements", { headers: htmlHeaders });
    await assertStatus(htmlList, 200);
    assert.equal((await htmlList.json()).canManage, true);

    const unauthorized = await appFetch("/api/improvements", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: improvementId, status: "checking", targetDate: "", updatedAt: created.updatedAt }),
    });
    assert.equal(unauthorized.status, 401);

    const forbidden = await appFetch("/api/improvements", {
      method: "PUT",
      headers: inputHeaders,
      body: JSON.stringify({ id: improvementId, status: "checking", targetDate: "", updatedAt: created.updatedAt }),
    });
    assert.equal(forbidden.status, 403);

    const update = await appFetch("/api/improvements", {
      method: "PUT",
      headers: htmlHeaders,
      body: JSON.stringify({ id: improvementId, status: "in_progress", targetDate: "2099-10-10", updatedAt: created.updatedAt }),
    });
    await assertStatus(update, 200);
    const updated = (await update.json()).improvement;
    assert.equal(updated.status, "in_progress");
    assert.equal(updated.targetDate, "2099-10-10");

    const staleUpdate = await appFetch("/api/improvements", {
      method: "PUT",
      headers: htmlHeaders,
      body: JSON.stringify({ id: improvementId, status: "resolved", targetDate: "", updatedAt: created.updatedAt }),
    });
    assert.equal(staleUpdate.status, 409);
  } finally {
    if (improvementId) {
      await runExactCleanup([
        { label: "개선사항 삭제", run: () => admin.from("improvement_requests").delete().eq("id", improvementId) },
        {
          label: "개선사항 잔여 확인",
          run: () => assertRowsAbsent(admin.from("improvement_requests").select("id").eq("id", improvementId), "개선사항"),
        },
      ]);
    }
  }
});
