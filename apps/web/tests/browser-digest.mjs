// Run from apps/web with an existing build. Synthetic UI/server only, no DB/RPC.
import assert from "node:assert/strict";
import { createBuiltSsrFixture, runIsolatedFixture } from "./helpers/built-ssr-fixture.mjs";

const SITE = "https://digest.fixture.invalid";
const PASSWORD = "synthetic-digest-fixture-only";

// Separate contract from the HTML-copy observer: PUT is allowed only here.
// Preserve the original fetch Promise and Response; observe a bounded clone.
export function installDigestResponseObserver({ origin }, target = globalThis) {
  if (origin !== "https://digest.fixture.invalid") throw new Error("Only digest fixture origin is allowed");
  const expected = new Map([
    ["GET /api/workspace", 200], ["GET /api/session", 200], ["POST /api/session", 200],
    ["DELETE /api/session", 204], ["POST /api/presence", 200], ["DELETE /api/presence", 204],
    ["PUT /api/submissions", 200],
  ]);
  const nativeFetch = target.fetch, records = [], occurrences = new Map();
  let errors = 0;
  Object.defineProperty(target, "__digestFetchDiagnostics", { get: () => records.map((item) => ({ ...item })) });
  Object.defineProperty(target, "__digestObserverErrors", { get: () => errors });
  target.fetch = function (...args) {
    let record, status;
    try {
      const input = args[0], isRequest = target.Request && input instanceof target.Request;
      const url = new URL(isRequest ? input.url : String(input), target.location.href);
      const method = String(args[1]?.method || (isRequest ? input.method : "GET")).toUpperCase();
      const key = `${method} ${url.pathname}`;
      if (url.origin === origin && expected.has(key)) {
        status = expected.get(key);
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        record = { key: `${key} #${occurrence}`, method, pathname: url.pathname, state: "pending", observerState: "pending" };
        records.push(record);
      }
    } catch { /* Leave native unsupported-input behavior untouched. */ }
    const fail = (reason) => { errors++; Object.assign(record, { observerState: "failed", reason }); };
    try {
      const promise = Reflect.apply(nativeFetch, this, args);
      if (record) promise.then(async (response) => {
        Object.assign(record, { state: "resolved", status: response.status, byteLength: 0 });
        if (!response.ok || response.status !== status) return fail("unexpected-status");
        try {
          const clone = response.clone();
          if (clone.body) {
            const reader = clone.body.getReader();
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                record.byteLength += chunk.value.byteLength;
                if (record.byteLength > 1024 * 1024 || (status === 204 && record.byteLength)) {
                  void reader.cancel().catch(() => undefined);
                  return fail("invalid-body-size");
                }
              }
            } finally { reader.releaseLock(); }
          }
          record.observerState = "completed";
        } catch { fail("clone-drain-failed"); }
      }, () => { record.state = "rejected"; fail("fetch-rejected"); });
      return promise;
    } catch (error) {
      if (record) { record.state = "threw"; fail("fetch-threw"); }
      throw error;
    }
  };
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

await runIsolatedFixture(import.meta.url, async () => {
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const otherMonth = month.endsWith("-01") ? `${Number(month.slice(0, 4)) - 1}-12`
    : `${month.slice(0, 4)}-${String(Number(month.slice(5)) - 1).padStart(2, "0")}`;
  const stamp = (index) => `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
  const names = ['합성 A <script>literal</script> & "책방"', "합성 B 책방", "합성 작성중 책방", "합성 다른달 책방"];
  const titles = ['합성 제목 <img src=x onerror=alert(1)> & "첫째"', "합성 제외 선택 제목", "합성 B의 다른 소식"];
  const bookstores = freeze(names.map((name, index) => ({ id: 93001 + index, updatedAt: stamp(index), sortOrder: index,
    name, region: index === 0 ? '가상 <b>지역</b> & "동네"' : `가상 지역 ${index}`,
    address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [] })));
  const news = (id, title) => ({ id, title, description: `DESCRIPTION_MUST_NOT_APPEAR_${id}\n상세 본문`,
    dates: [], scheduleRange: null, scheduleText: "", regular: false, displayLabel: "", deadline: "",
    place: "", fee: "", applicationInfo: "", applyUrl: "", extraFields: [], links: [], includeInDigest: true, images: [] });
  const seeds = freeze(bookstores.map((bookstore, index) => ({ id: 94001 + index, bookstoreId: bookstore.id,
    month: index === 3 ? otherMonth : month, status: index === 2 ? "draft" : "completed", updatedAt: stamp(index),
    completedAt: index === 2 ? "" : stamp(index), publishedAt: "", publishedUrl: "", monthlyNotice: "NOTICE_MUST_NOT_APPEAR",
    news: index === 0 ? [news(95001, titles[0]), news(95002, titles[1])]
      : [news(95003 + index, index === 1 ? titles[2] : `숨겨진 제목 ${index}`)] })));
  // Server-owned frozen records; never serialize a UI array or accept its order.
  const store = new Map(seeds.map((item) => [item.id, item]));
  const unchanged = JSON.stringify(seeds.slice(2));
  let saveSequence = 0, session = null;
  const leases = new Set(), writes = [], results = [], observations = [];
  const load = () => ({ bookstores: structuredClone(bookstores), submissions: structuredClone([...store.values()]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) }); // Actual GET: updated_at ascending.
  const protectedUnchanged = () => assert.equal(JSON.stringify([store.get(94003), store.get(94004)]), unchanged,
    "draft and other-month server records must stay byte-for-byte unchanged");
  const fixture = await createBuiltSsrFixture({ origin: SITE, observer: installDigestResponseObserver,
    api: async ({ pathname, method, body, headers }) => {
      const supplied = Object.entries(headers).find(([key]) => key.toLowerCase() === "x-workspace-session-id")?.[1];
      if (pathname === "/api/session" && method === "POST") {
        assert.ok(!session && body.role === "html" && body.code === PASSWORD, "only synthetic HTML login is accepted");
        assert.ok(typeof body.sessionId === "string" && /^[a-zA-Z0-9-]{16,100}$/.test(body.sessionId), "login must supply tab-scoped synthetic ID");
        session = body.sessionId;
        return { status: 200, body: { role: "html" } };
      }
      if (pathname === "/api/workspace" && method === "GET") {
        assert.ok(!supplied || supplied === session, "workspace worker session must match this context");
        return { status: 200, body: load() };
      }
      assert.ok(session && supplied === session, "write/session API requires current fixture context");
      if (pathname === "/api/session" && method === "GET") return { status: 200, body: { role: "html" } };
      if (pathname === "/api/session" && method === "DELETE") {
        assert.equal(leases.size, 0, "logout must release fixture leases first");
        session = null;
        return { status: 204 };
      }
      if (pathname === "/api/presence" && ["POST", "DELETE"].includes(method)) {
        assert.ok(body.month === month && (body.scope === "digest"
          || (body.scope === "submission" && [93001, 93002].includes(body.bookstoreId))), "lease must target only current synthetic context");
        const key = `${body.scope}:${body.bookstoreId || ""}:${body.month}`;
        if (method === "DELETE") {
          assert.equal(body.sessionId, session, "lease release must carry current synthetic session");
          leases.delete(key);
          return { status: 204 };
        }
        leases.add(key);
        return { status: 200, body: { owned: true, activeRole: "html", expiresAt: "2099-01-01T00:00:00.000Z" } };
      }
      assert.ok(pathname === "/api/submissions" && method === "PUT", "unexpected API is forbidden");
      const requested = body.submission, existing = store.get(requested?.id);
      assert.ok(existing && existing.month === month && existing.status === "completed", "only current completed fixture rows may be saved");
      assert.equal(requested.updatedAt, existing.updatedAt, "mock save must respect actual optimistic version");
      const requestedById = new Map(requested.news.map((item) => [item.id, item.includeInDigest]));
      assert.equal(requestedById.size, existing.news.length, "mock selection must preserve news identities");
      for (const item of existing.news) assert.equal(typeof requestedById.get(item.id), "boolean", "selection must be explicit boolean");
      // Mirrors HTML role's API merge; cannot save title/body/status/order from UI.
      const saved = freeze({ ...existing, updatedAt: `2090-01-01T00:00:${String(++saveSequence).padStart(2, "0")}.000Z`,
        publishedAt: requested.publishedAt, publishedUrl: requested.publishedUrl,
        news: existing.news.map((item) => ({ ...item, includeInDigest: requestedById.get(item.id) })) });
      store.set(saved.id, saved);
      writes.push({ submissionId: saved.id, sequence: saveSequence });
      return { status: 200, body: structuredClone(saved) };
    } });
  const { page } = fixture;
  const cards = page.locator(".digest-control article");
  const preview = page.frameLocator('iframe[title="통합 HTML 미리보기"]');
  const tc = async (id, callback) => {
    try { await callback(); results.push({ id, status: "PASS" }); console.log(`PASS ${id}`); }
    catch (error) {
      results.push({ id, status: "FAIL" });
      console.log(`FAIL ${id}: ${error?.code === "ERR_ASSERTION" ? String(error.message).split("\n")[0] : "automation/environment"}`);
      process.exitCode = 1;
    }
  };
  const openDigest = async () => {
    await page.getByRole("button", { name: "통합본 만들기", exact: true }).click();
    await cards.first().waitFor();
    await preview.locator("section").first().waitFor();
  };
  const collect = async () => { const value = await fixture.diagnostics(); observations.push(value); return value; };
  const reloadDigest = async () => {
    await collect();
    await page.reload();
    await openDigest();
  };
  try {
    await page.goto(SITE);
    await page.getByRole("button", { name: "HTML 편집", exact: true }).click();
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator(".access-modal .primary-button").click();
    await openDigest();
    await tc("DIGEST-01", async () => {
      assert.equal(await cards.count(), 2, "only two current completed bookstores are selectable");
      assert.equal(await preview.locator("h1").innerText(), `지관서가 전해주는 동네 책방 ${month.slice(0, 4)}년 ${Number(month.slice(5))}월 소식`, "digest heading must use selected month");
      assert.deepEqual(await preview.locator("li").allTextContents(), titles, "digest includes selected titles, not descriptions");
      const headings = await preview.locator("section h2").allTextContents();
      assert.deepEqual(headings, bookstores.slice(0, 2).map((item) => `${item.name} (${item.region})`), "bookstore and region must remain literal heading text");
      assert.equal(await preview.locator("script,img,iframe,style,b").count(), 0, "heading/title HTML input must not create markup");
      assert.ok(!(await preview.locator("body").innerText()).includes("MUST_NOT_APPEAR"), "digest must not include description or monthly notice");
      assert.equal(writes.length, 0, "reading digest must not save source data");
      protectedUnchanged();
    });
    await tc("DIGEST-02", async () => {
      const previousWrites = writes.length;
      const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/submissions" && response.request().method() === "PUT" && response.status() === 200);
      await page.getByLabel(titles[1], { exact: true }).uncheck();
      await savedResponse;
      assert.ok(writes.length > previousWrites, "include checkbox must issue a successful PUT");
      assert.equal(store.get(94001).news[1].includeInDigest, false, "PUT must change the server-owned include flag");
      await reloadDigest();
      assert.equal(await page.getByLabel(titles[1], { exact: true }).isChecked(), false, "include selection must survive server reload");
      assert.deepEqual((await preview.locator("li").allTextContents()).sort(), [titles[0], titles[2]].sort(), "reloaded digest must omit only unchecked title");
      protectedUnchanged();
    });
    await tc("DIGEST-03", async () => {
      const before = await cards.locator("header strong").allTextContents();
      const expected = before.map((text) => text.replace(/^\d+\. /, "")).reverse();
      const previousWrites = writes.length;
      // Actual HTML5 drag events go through the component's onDragStart/onDrop.
      await cards.first().dragTo(cards.last());
      assert.deepEqual((await cards.locator("header strong").allTextContents()).map((text) => text.replace(/^\d+\. /, "")), expected,
        "drag must immediately reverse the two-book UI order");
      await page.waitForTimeout(1_800); // Longer than actual 1,200ms auto-save debounce.
      const saved = writes.length > previousWrites;
      await reloadDigest();
      const reloaded = (await cards.locator("header strong").allTextContents()).map((text) => text.replace(/^\d+\. /, ""));
      protectedUnchanged();
      assert.deepEqual(reloaded, expected, "bookstore drag order must survive server-owned GET/reload");
      assert.ok(saved, "bookstore reorder must persist through successful PUT rather than UI array only");
    });
    await collect();
    const diagnostics = observations.at(-1);
    console.log(JSON.stringify({ results, diagnostics: { ...diagnostics, fetches: observations.flatMap((value) => value.fetches) },
      syntheticWrites: writes.length, protectedRecordsUnchanged: JSON.stringify([store.get(94003), store.get(94004)]) === unchanged,
      realDatabaseChanges: 0 }));
    assert.ok(Object.values(diagnostics.counts).every((count) => count === 0), "unexpected console/API/network/handler failures must be zero");
    assert.ok(observations.every((value) => value.observerErrors === 0
      && value.fetches.every((record) => record.observerState === "completed" && record.state === "resolved")
      && value.requests.every((record) => record.state === "finished")), "all API observations must complete without weakening assertions");
  } finally { await fixture.close(); }
});
