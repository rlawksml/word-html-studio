// Mounted negative/lifecycle cases. Synthetic HTTP200 only; no real DB/RPC/keys.
// Positive DIGEST01~03 assertions remain unchanged in browser-digest.mjs.
import assert from "node:assert/strict";
import { createBuiltSsrFixture, runIsolatedFixture } from "./helpers/built-ssr-fixture.mjs";
import { installDigestResponseObserver } from "./helpers/digest-response-observer.mjs";

const SITE = "https://digest.fixture.invalid";
const PASSWORD = "synthetic-digest-lifecycle-only";
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

await runIsolatedFixture(import.meta.url, async () => {
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const otherMonth = month.endsWith("-01") ? `${Number(month.slice(0, 4)) - 1}-12`
    : `${month.slice(0, 4)}-${String(Number(month.slice(5)) - 1).padStart(2, "0")}`;
  const allowedMonths = new Set([month, otherMonth]);
  const stamp = "2026-01-01T00:00:00.000Z";
  const bookstores = ["합성 수록 A", "합성 수록 B", "합성 다른 달"].map((name, index) => ({
    id: 96001 + index, name, region: "가상 지역", updatedAt: stamp, sortOrder: index,
    address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [],
  }));
  const submissions = bookstores.map((bookstore, index) => ({ id: 97001 + index, bookstoreId: bookstore.id,
    month: index === 2 ? otherMonth : month, status: "completed", updatedAt: stamp, completedAt: stamp,
    publishedAt: "", publishedUrl: "", monthlyNotice: "",
    news: [{ id: 98001 + index, title: `합성 제목 ${index}`, description: "보존할 합성 본문",
      dates: [], scheduleRange: null, scheduleText: "", regular: false, displayLabel: "", deadline: "",
      place: "", fee: "", applicationInfo: "", applyUrl: "", extraFields: [], links: [], includeInDigest: true, images: [] }],
  }));
  const originalSources = JSON.stringify({ bookstores, submissions });
  const monthlyOrders = new Map([
    [month, { month, submissionIds: [97002, 97001], revision: 1, updatedAt: stamp }],
    [otherMonth, { month: otherMonth, submissionIds: [97003], revision: 1, updatedAt: stamp }],
  ]);
  const leases = new Set(), gates = [], writes = [], reads = [], presence = [], results = [];
  let session = null, available = true, denyNextDigestRefresh = false;
  let fixture;
  function hold(method, selectedMonth, cancel = false) {
    const occurrence = reads.filter((item) => item.method === method && item.month === selectedMonth).length + 1;
    const started = deferred(), released = deferred();
    const plan = cancel ? fixture.planDigestCancellation(method, selectedMonth) : null;
    if (plan) assert.equal(plan.occurrence, occurrence, "planned cancellation must identify the exact next request");
    const gate = { method, month: selectedMonth, occurrence, started: started.promise,
      release: released.resolve, entered: started.resolve, wait: released.promise, plan };
    gates.push(gate);
    return gate;
  }
  fixture = await createBuiltSsrFixture({ origin: SITE, allowIntentionalDigestCancellation: true,
    observer: installDigestResponseObserver, observerOptions: { observeOrder: false },
    api: async ({ pathname, method, body, headers, queryMonth, requestOccurrence }) => {
      const supplied = Object.entries(headers).find(([key]) => key.toLowerCase() === "x-workspace-session-id")?.[1];
      if (pathname === "/api/session" && method === "POST") {
        assert.ok(!session && body.role === "html" && body.code === PASSWORD);
        assert.ok(typeof body.sessionId === "string" && /^[a-zA-Z0-9-]{16,100}$/.test(body.sessionId));
        session = body.sessionId;
        return { status: 200, body: { role: "html" } };
      }
      if (pathname === "/api/workspace" && method === "GET") {
        assert.ok(!supplied || supplied === session);
        return { status: 200, body: structuredClone({ bookstores, submissions }) };
      }
      assert.ok(session && supplied === session, "all worker APIs require this synthetic session");
      if (pathname === "/api/session" && method === "GET") return { status: 200, body: { role: "html" } };
      if (pathname === "/api/presence" && ["POST", "DELETE"].includes(method)) {
        assert.ok(allowedMonths.has(body.month));
        assert.ok(body.scope === "digest" || (body.scope === "submission" && submissions.some((item) => item.month === body.month && item.bookstoreId === body.bookstoreId)));
        const key = `${body.scope}:${body.bookstoreId || ""}:${body.month}`;
        if (method === "DELETE") {
          assert.equal(body.sessionId, session); leases.delete(key); return { status: 204 };
        }
        const owned = !(body.scope === "digest" && denyNextDigestRefresh);
        if (!owned) { denyNextDigestRefresh = false; leases.delete(key); } else leases.add(key);
        presence.push({ scope: body.scope, month: body.month, owned });
        return { status: 200, body: { owned, activeRole: "html", expiresAt: "2099-01-01T00:00:00Z" } };
      }
      assert.equal(pathname, "/api/digest-order", "negative fixture must never write source records");
      assert.ok(allowedMonths.has(queryMonth) && ["GET", "PUT"].includes(method));
      reads.push({ method, month: queryMonth, occurrence: requestOccurrence });
      let result;
      if (method === "GET") result = available ? { available: true, order: structuredClone(monthlyOrders.get(queryMonth)) } : { available: false };
      else {
        assert.ok(available && leases.has(`digest::${queryMonth}`), "order writes require current owned lease");
        assert.deepEqual(Object.keys(body).sort(), ["month", "revision", "submissionIds"]);
        const existing = monthlyOrders.get(queryMonth);
        assert.equal(body.month, queryMonth); assert.equal(body.revision, existing.revision);
        assert.ok(Number.isSafeInteger(body.revision) && body.revision >= 0 && body.revision < Number.MAX_SAFE_INTEGER);
        assert.ok(Array.isArray(body.submissionIds) && body.submissionIds.length <= 500);
        assert.equal(new Set(body.submissionIds).size, body.submissionIds.length);
        for (const id of body.submissionIds) assert.ok(Number.isSafeInteger(id) && id > 0 && submissions.some((item) => item.id === id && item.month === queryMonth));
        const saved = { ...structuredClone(body), revision: existing.revision + 1, updatedAt: stamp };
        monthlyOrders.set(queryMonth, saved); writes.push(structuredClone(body));
        result = { available: true, order: structuredClone(saved) };
      }
      const gate = gates.find((item) => item.method === method && item.month === queryMonth && item.occurrence === requestOccurrence);
      if (gate) { gate.entered(); await gate.wait; }
      return { status: 200, body: result }; // Snapshot captured before the gate, intentionally stale when released late.
    } });
  const { page } = fixture;
  await fixture.context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value) => { window.__digestCopied = value; } } });
  });
  const cards = page.locator(".digest-control article");
  const status = page.locator(".digest-order-status");
  const monthInput = page.locator('.html-sidebar input[type="month"]');
  const ready = async () => {
    await page.getByText(/^(기본|저장된) 순서입니다\. 손잡이로 순서를 변경하면 자동 저장됩니다\.$/).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".digest-order-handle")].length > 0
      && [...document.querySelectorAll(".digest-order-handle")].every((item) => !item.disabled));
  };
  const enter = () => page.getByRole("button", { name: "통합본 만들기", exact: true }).click();
  const leave = () => page.getByRole("button", { name: /^개별 HTML/ }).click();
  const reload = () => status.getByRole("button", { name: "최신 순서 불러오기", exact: true }).click();
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const entered = async (gate) => {
    let timer;
    try {
      await Promise.race([gate.started, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Synthetic gate was not reached")), 12_000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const cancelled = (gate) => page.waitForEvent("requestfailed", (request) => {
    const url = new URL(request.url());
    return request.method() === gate.method && url.pathname === "/api/digest-order" && url.searchParams.get("month") === gate.month
      && request.failure()?.errorText === "net::ERR_ABORTED";
  });
  const names = () => cards.locator("header strong").allTextContents();
  const tc = async (id, run) => {
    try { await run(); results.push({ id, status: "PASS" }); console.log(`PASS ${id}`); }
    catch (error) {
      results.push({ id, status: "FAIL" }); process.exitCode = 1;
      console.log(`FAIL ${id}: ${error?.code === "ERR_ASSERTION" ? String(error.message).split("\n")[0] : "automation/environment"}`);
      for (const gate of gates) gate.release();
      throw error; // Do not cascade from a failed lifecycle precondition into misleading PASSes.
    }
  };
  try {
    await page.goto(SITE);
    await page.getByRole("button", { name: "HTML 편집", exact: true }).click();
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator(".access-modal .primary-button").click();
    await enter(); await ready();

    await tc("DIGEST-04", async () => {
      available = false;
      const before = writes.length;
      await reload();
      await status.getByText("통합본 순서 저장이 아직 설정되지 않았습니다. 미리보기와 복사는 사용할 수 있습니다.", { exact: true }).waitFor();
      assert.equal(await cards.count(), 2);
      assert.equal(await cards.locator(".digest-order-handle:disabled").count(), 2);
      const preview = page.frameLocator('iframe[title="통합 HTML 미리보기"]');
      assert.equal(await preview.locator("section h2").count(), 2);
      await page.locator(".digest-output").getByRole("button", { name: "HTML 복사", exact: true }).click();
      await page.waitForFunction(() => window.__digestCopied?.includes("합성 수록 A") && window.__digestCopied.includes("합성 수록 B"));
      assert.equal(writes.length, before, "unavailable capability must not issue PUT");
      available = true; await reload(); await ready();
    });

    await tc("DIGEST-05", async () => {
      const oldMonth = hold("GET", month, true);
      await reload(); await entered(oldMonth);
      const changed = cancelled(oldMonth);
      await monthInput.fill(otherMonth); await changed; await ready();
      oldMonth.release(); await frames();
      await ready();
      assert.equal(await status.getByRole("button").isDisabled(), false, "old month completion must preserve the new month's ready state");
      assert.equal(await monthInput.inputValue(), otherMonth);
      assert.deepEqual(await names(), ["1. 합성 다른 달"], "old month response must not overwrite current month");
      const oldView = hold("GET", otherMonth, true);
      await reload(); await entered(oldView);
      const closed = cancelled(oldView);
      await leave(); await closed;
      const reentryGet = hold("GET", otherMonth);
      await enter(); await entered(reentryGet);
      oldView.release(); await frames();
      await status.getByText("책방 소식의 수록 순서를 불러오고 있습니다.", { exact: true }).waitFor();
      assert.equal(await status.getByRole("button").isDisabled(), true, "closed-view completion must not unlock the reentry GET");
      assert.equal(await cards.locator(".digest-order-handle:disabled").count(), 1);
      reentryGet.release(); await ready();
      assert.deepEqual(await names(), ["1. 합성 다른 달"], "closed digest response must not overwrite reentered scope");
      await monthInput.fill(month); await ready();
      assert.equal(writes.length, 0, "month and mode transitions must remain read-only");
    });

    await tc("DIGEST-06", async () => {
      const oldPut = hold("PUT", month, true), before = writes.length;
      await cards.first().locator(".digest-order-handle").dragTo(cards.last()); await entered(oldPut);
      await status.getByText("편집 권한을 확인하고 순서를 저장하고 있습니다.", { exact: true }).waitFor();
      await cards.first().dispatchEvent("drop"); await cards.last().dispatchEvent("drop"); await frames();
      assert.equal(writes.length - before, 1, "consecutive drops while pending must issue only one PUT");
      const closed = cancelled(oldPut);
      await leave(); await closed;
      const newGet = hold("GET", month);
      await enter(); await entered(newGet);
      oldPut.release(); await frames();
      assert.equal(await status.getByRole("button").isDisabled(), true, "old completion must not turn a new GET into ready state");
      assert.equal(await cards.locator(".digest-order-handle:disabled").count(), 2);
      assert.equal(reads.filter((item) => item.method === "GET" && item.month === month && item.occurrence === newGet.occurrence).length, 1);
      newGet.release(); await ready();
      assert.deepEqual(await names(), ["1. 합성 수록 A", "2. 합성 수록 B"], "new GET must still own its single-flight slot and apply its committed order");
      assert.equal(writes.length - before, 1, "mode transition and late PUT must not retry writes");
    });

    await tc("DIGEST-07", async () => {
      const before = writes.length, existing = structuredClone(monthlyOrders.get(month));
      assert.equal(presence.at(-1).owned, true, "UI must initially have a confirmed owned lease");
      denyNextDigestRefresh = true;
      await cards.first().locator(".digest-order-handle").dragTo(cards.last());
      await status.getByText("다른 작업자가 편집 중이거나 편집 권한이 만료되었습니다.", { exact: true }).waitFor();
      assert.equal(presence.at(-1).owned, false, "only immediate pre-save refresh returns ownedfalse HTTP200");
      assert.equal(writes.length, before, "failed authoritative lease refresh must issue no PUT");
      assert.deepEqual(monthlyOrders.get(month), existing);
      await reload();
      await page.getByText(/^(기본|저장된) 순서입니다\. 손잡이로 순서를 변경하면 자동 저장됩니다\.$/).waitFor();
      assert.equal(presence.at(-1).owned, false, "a read-only reload must not restore the lease");
      assert.equal(await cards.locator(".digest-order-handle:disabled").count(), 2, "occupied lease keeps dragging disabled after successful order read");
      await leave(); await enter(); await ready();
      assert.equal(presence.at(-1).owned, true);
      assert.equal(writes.length, before, "explicit reload recovery must not auto-save a failed drag");
    });
    for (const gate of gates) gate.release();
    await frames();
    const diagnostics = await fixture.diagnostics();
    const sourceRecordsUnchanged = JSON.stringify({ bookstores, submissions }) === originalSources;
    // Always emit only synthetic metadata before checking invariants, including on failure.
    console.log(JSON.stringify({ results, diagnostics, sourceRecordsUnchanged, orderWrites: writes.length, realDatabaseChanges: 0,
      limits: ["409/lost-response UI not covered", "clipboard is synthetic", "wire-observation coverage gap remains separate"] }));
    const invariant = (id, check) => {
      try { check(); }
      catch {
        console.log(`FAIL DIGEST-FINAL-${id}`); // Fixed caller IDs only; never print raw exception/request data.
        throw new Error("Synthetic final invariant failed");
      }
    };
    invariant("SOURCE-UNCHANGED", () => assert.equal(sourceRecordsUnchanged, true));
    const expected = diagnostics.cancellations;
    invariant("HANDLERS-SETTLED", () => assert.equal(expected.activeHandles, 0));
    invariant("THREE-PLANNED-CANCELLATIONS", () => assert.ok(expected.plans.length === 3 && expected.plans.every((plan) => plan.observed)));
    invariant("NO-UNEXPECTED-TRANSPORT", () => assert.equal(diagnostics.counts.transportFailures, expected.expectedTransportAborts));
    invariant("NO-UNEXPECTED-HANDLER", () => assert.equal(diagnostics.counts.handlerErrors, expected.expectedCancelledFulfillments));
    invariant("OBSERVER-ERRORS-ZERO", () => assert.equal(diagnostics.observerErrors, 0));
    invariant("OBSERVED-RESPONSES-COMPLETE", () => assert.ok(diagnostics.fetches.every((record) => record.state === "resolved" && record.observerState === "completed")));
    for (const key of ["nodeNetworkAttempts", "externalAttempts", "consoleErrors", "pageErrors"]) {
      invariant(`ZERO-${key}`, () => assert.equal(diagnostics.counts[key], 0));
    }
    invariant("ALL-REQUESTS-ACCOUNTED", () => assert.ok(diagnostics.requests.every((record) => record.state === "finished"
      || (record.state === "cancelled-expected" && expected.plans.some((plan) => plan.key === record.cancellationKey && plan.observed)))));
  } finally {
    for (const gate of gates) gate.release();
    await fixture.close();
  }
});
