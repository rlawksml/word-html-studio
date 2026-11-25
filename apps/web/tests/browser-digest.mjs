// Run from apps/web with an existing build. Synthetic UI/server only, no DB/RPC.
import assert from "node:assert/strict";
import { createBuiltSsrFixture, runIsolatedFixture } from "./helpers/built-ssr-fixture.mjs";
import { installDigestResponseObserver } from "./helpers/digest-response-observer.mjs";

const SITE = "https://digest.fixture.invalid";
const PASSWORD = "synthetic-digest-fixture-only";


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
  // Separate server-owned table: ordering must not depend on Workspace array order.
  const monthlyOrders = new Map(), orderReads = [], orderWrites = [];
  const unchanged = JSON.stringify(seeds.slice(2));
  let saveSequence = 0, session = null;
  const leases = new Set(), writes = [], results = [], observations = [];
  const load = () => ({ bookstores: structuredClone(bookstores), submissions: structuredClone([...store.values()]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) }); // Actual GET: updated_at ascending.
  const protectedUnchanged = () => assert.equal(JSON.stringify([store.get(94003), store.get(94004)]), unchanged,
    "draft and other-month server records must stay byte-for-byte unchanged");
  const fixture = await createBuiltSsrFixture({ origin: SITE, observer: installDigestResponseObserver,
    api: async ({ pathname, method, body, headers, queryMonth }) => {
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
      if (pathname === "/api/digest-order") {
        assert.equal(queryMonth, month, "digest API must target only this synthetic month");
        const existing = monthlyOrders.get(month) ?? freeze({ month, submissionIds: [], revision: 0, updatedAt: "" });
        if (method === "GET") {
          orderReads.push(structuredClone(existing));
          return { status: 200, body: { available: true, order: structuredClone(existing) } };
        }
        assert.equal(method, "PUT", "digest API only accepts GET and PUT");
        assert.ok(leases.has(`digest::${month}`), "digest PUT requires owned HTML digest lease");
        assert.deepEqual(Object.keys(body).sort(), ["month", "revision", "submissionIds"], "digest payload must be exact DTO");
        assert.equal(body.month, month);
        assert.ok(Number.isSafeInteger(body.revision) && body.revision >= 0 && body.revision < Number.MAX_SAFE_INTEGER);
        assert.equal(body.revision, existing.revision, "digest PUT must respect revision CAS");
        assert.ok(Array.isArray(body.submissionIds) && body.submissionIds.length <= 500);
        assert.equal(new Set(body.submissionIds).size, body.submissionIds.length, "digest IDs must be unique");
        for (const id of body.submissionIds) {
          assert.ok(Number.isSafeInteger(id) && id > 0 && store.get(id)?.month === month, "digest IDs must exist in current month");
        }
        const saved = freeze({ month, submissionIds: [...body.submissionIds], revision: existing.revision + 1,
          updatedAt: `2091-01-01T00:00:${String(existing.revision + 1).padStart(2, "0")}.000Z` });
        monthlyOrders.set(month, saved);
        orderWrites.push(structuredClone(body));
        return { status: 200, body: { available: true, order: structuredClone(saved) } };
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
    await page.getByText(/^(기본|저장된) 순서입니다\. 손잡이로 순서를 변경하면 자동 저장됩니다\.$/).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".digest-order-handle")].every((handle) => !handle.disabled));
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
      assert.equal(orderWrites.length, 0, "reading digest must not persist a new order");
      assert.deepEqual(orderReads, [{ month, submissionIds: [], revision: 0, updatedAt: "" }], "initial order GET must expose explicit empty revision0");
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
      const previousOrderWrites = orderWrites.length;
      const sourceBefore = JSON.stringify([...store.values()]);
      const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/digest-order"
        && response.request().method() === "PUT" && response.status() === 200);
      // Only the handle starts HTML5 drag; article text/checkboxes are not draggable.
      assert.equal(await cards.first().getAttribute("draggable"), null);
      await cards.first().locator(".digest-order-handle").dragTo(cards.last());
      await savedResponse;
      await page.getByText("통합본 순서를 저장했습니다.", { exact: true }).waitFor();
      assert.deepEqual((await cards.locator("header strong").allTextContents()).map((text) => text.replace(/^\d+\. /, "")), expected,
        "successful dedicated order save must reverse the two-book UI order");
      assert.equal(orderWrites.length - previousOrderWrites, 1, "one drag must issue exactly one order PUT");
      assert.deepEqual(orderWrites.at(-1), { month, submissionIds: [94002, 94001], revision: 0 }, "order PUT must carry exact month, IDs and expected revision");
      assert.equal(writes.length, previousWrites, "order save must not issue Submission PUT");
      assert.equal(JSON.stringify([...store.values()]), sourceBefore, "order save must preserve every source Submission byte-for-byte");
      await reloadDigest();
      const reloaded = (await cards.locator("header strong").allTextContents()).map((text) => text.replace(/^\d+\. /, ""));
      protectedUnchanged();
      assert.deepEqual(reloaded, expected, "bookstore drag order must survive server-owned GET/reload");
      assert.deepEqual(orderReads.at(-1), { month, submissionIds: [94002, 94001], revision: 1, updatedAt: "2091-01-01T00:00:01.000Z" },
        "reloaded order GET must return persisted month, IDs and advanced revision");
      assert.deepEqual(await preview.locator("section h2").allTextContents(), [bookstores[1], bookstores[0]].map((item) => `${item.name} (${item.region})`),
        "reloaded combined HTML must use the same persisted order as cards");
      assert.equal(JSON.stringify([...store.values()]), sourceBefore, "reloading order must not mutate source records");
    });
    await collect();
    const diagnostics = observations.at(-1);
    console.log(JSON.stringify({ results, diagnostics: { ...diagnostics, fetches: observations.flatMap((value) => value.fetches) },
      syntheticWrites: writes.length, syntheticOrderWrites: orderWrites.length, syntheticOrderReads: orderReads.length,
      protectedRecordsUnchanged: JSON.stringify([store.get(94003), store.get(94004)]) === unchanged,
      realDatabaseChanges: 0 }));
    assert.ok(Object.values(diagnostics.counts).every((count) => count === 0), "unexpected console/API/network/handler failures must be zero");
    assert.ok(observations.every((value) => value.observerErrors === 0
      && value.fetches.every((record) => record.observerState === "completed" && record.state === "resolved")
      && value.requests.every((record) => record.state === "finished")), "all API observations must complete without weakening assertions");
  } finally { await fixture.close(); }
});
