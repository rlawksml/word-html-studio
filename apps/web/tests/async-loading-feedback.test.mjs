import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPendingActionLock } from "../lib/pending-action-lock.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

async function renderSessionDelete(headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("async-loading-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/api/session", { method: "DELETE", headers }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("guards worker login while showing authentication and workspace loading phases", async () => {
  const [controller, feedback, sessionRoute] = await Promise.all([
    read("../hooks/use-studio-controller.ts"),
    read("../components/molecules/StudioFeedback.tsx"),
    read("../app/api/session/route.ts"),
  ]);

  assert.match(controller, /pendingActionRef\.current/);
  assert.match(controller, /beginPendingAction\("login-authenticating"\)/);
  assert.match(controller, /changePendingAction\("login-workspace"\)/);
  assert.match(controller, /method: "DELETE", headers: workspaceSessionHeaders\(\)/);
  assert.match(controller, /AbortSignal\.timeout\(3_000\)/);
  assert.match(controller, /removeItem\("bookstore-news-session-id"\)/);
  assert.match(controller, /finally \{\s*finishPendingAction\(\);\s*\}/);

  assert.match(feedback, /aria-busy=\{loginPending\}/);
  assert.match(feedback, /disabled=\{loginPending\}/);
  assert.match(feedback, /disabled=\{loginPending \|\| !password\.trim\(\)\}/);
  assert.match(feedback, /작업 암호를 확인하고 있어요/);
  assert.match(feedback, /동네책방 작업 공간을 준비하고 있어요/);
  assert.match(feedback, /role="status" aria-live="polite"/);
  assert.match(feedback, /tabIndex=\{-1\} autoFocus/);
  assert.match(feedback, /passwordInputRef\.current\?\.focus\(\)/);
  assert.match(feedback, /leaveContinueRef\.current\?\.focus\(\)/);
  assert.match(sessionRoute, /requestedSessionId && !\(await readWorkerSession\(request, requestedSessionId\)\)/);
});

test("clears an unconditional logout cookie but never clears a mismatched rollback session", async () => {
  const logout = await renderSessionDelete();
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie") ?? "", /bookstore_news_session=;/);

  const staleRollback = await renderSessionDelete({ "x-workspace-session-id": "00000000-0000-4000-8000-000000000000" });
  assert.equal(staleRollback.status, 204);
  assert.equal(staleRollback.headers.get("set-cookie"), null);
});

test("executes a pending async action once and unlocks it after success or failure", async () => {
  const transitions = [];
  const lock = createPendingActionLock((action) => transitions.push(action));
  let calls = 0;
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const run = async () => {
    if (!lock.begin("manual-save")) return false;
    try {
      calls += 1;
      await delayed;
      return true;
    } finally {
      lock.finish();
    }
  };

  const first = run();
  const duplicate = await run();
  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(lock.current, null);
  assert.deepEqual(transitions, ["manual-save", null]);

  assert.equal(lock.begin("download-bundle"), true);
  try {
    throw new Error("ZIP generation failed");
  } catch {
    lock.finish();
  }
  assert.equal(lock.begin("download-bundle"), true);
  lock.finish();
});

test("prevents duplicate save, completion, leave, and ZIP actions while they are pending", async () => {
  const [controller, editor, feedback, htmlWorkspace] = await Promise.all([
    read("../hooks/use-studio-controller.ts"),
    read("../components/organisms/NewsEditorWorkspace.tsx"),
    read("../components/molecules/StudioFeedback.tsx"),
    read("../components/organisms/HtmlWorkspace.tsx"),
  ]);

  for (const action of ["manual-save", "complete-submission", "leave-save", "leave-discard"]) {
    assert.match(controller, new RegExp(`beginPendingAction\\(\"${action}\"`));
  }
  assert.match(controller, /const downloadAction = withHtml \? "download-bundle" : "download-photos"/);
  assert.match(controller, /beginPendingAction\(downloadAction\)/);
  assert.match(editor, /disabled=\{imageUploadNewsId !== null \|\| submissionPending\}/);
  assert.match(editor, /임시 저장 중/);
  assert.match(editor, /입력 완료 저장 중/);
  assert.match(editor, /inert=\{pendingAction === "complete-submission" \|\| undefined\}/);
  assert.match(feedback, /disabled=\{leavePending\}/);
  assert.match(htmlWorkspace, /disabled=\{downloadPending\}/);
  assert.match(htmlWorkspace, /원본 사진을 모아 다운로드 파일을 준비하고 있어요/);
  assert.match(controller, /저장이 끝난 뒤 책방 목록으로 이동해 주세요/);
  assert.match(controller, /pendingActionRef\.current === "complete-submission"/);
  assert.match(controller, /finally \{\s*finishPendingAction\(\);\s*\}/g);
});
