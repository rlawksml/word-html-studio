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

  try {
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

    const reserve = await appFetch("/api/images", {
      method: "POST", headers: workerHeaders,
      body: JSON.stringify({ name: "integration.jpg", type: "image/jpeg", size: 4, previewSize: 4, month: "2099-12", bookstoreId, newsId }),
    });
    await assertStatus(reserve, 201);
    const reservation = await reserve.json();
    uploadedImage = reservation.image;
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "integration.jpg", { type: "image/jpeg" });
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
  }
});
