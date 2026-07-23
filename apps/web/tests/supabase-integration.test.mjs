import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

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
        id: newsId, title: "통합 테스트 소식", description: "자동으로 정리되는 테스트 데이터입니다.", dates: ["2099-12-01"], scheduleText: "", regular: false,
        displayLabel: "", deadline: "", place: "", fee: "", applicationInfo: "", applyUrl: "", extraFields: [], links: [], images: [], includeInDigest: true,
      }],
    };
    const createSubmission = await appFetch("/api/submissions", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ submission }) });
    await assertStatus(createSubmission, 200);
    const firstSubmission = (await createSubmission.json()).submission;
    const updateSubmission = await appFetch("/api/submissions", { method: "PUT", headers: workerHeaders, body: JSON.stringify({ submission: { ...firstSubmission, monthlyNotice: "수정됨" } }) });
    await assertStatus(updateSubmission, 200);
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
    if (uploadedImage) {
      await Promise.all([
        admin.storage.from("bookstore-news-originals").remove([uploadedImage.originalPath]),
        admin.storage.from("bookstore-news-previews").remove([uploadedImage.previewPath]),
      ]);
    }
    await admin.from("submissions").delete().eq("id", submissionId);
    await admin.from("bookstores").delete().eq("id", bookstoreId);
    await admin.from("editing_leases").delete().eq("resource_key", `submission:2099-12:${bookstoreId}`);
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
    await admin.from("editing_leases").delete().in("resource_key", [`submission:2099-11:${bookstoreId}`, "digest:2099-11"]);
  }
});
