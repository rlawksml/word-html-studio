import assert from "node:assert/strict";
import test from "node:test";
import { assertLegacyIntegrationBlocked } from "./helpers/owned-cleanup-plan.mjs";
import { canonical, qaMarker } from "./helpers/test-owned-ledger.mjs";
import { createMemorySupabaseMock } from "./helpers/mock-owned-supabase.mjs";
import { createMockOnlySupabaseAdapter } from "./helpers/test-owned-supabase-adapter.mjs";

const target = { APP_ENV: "staging", SUPABASE_URL: "https://kriyjyyudngtibrtkylf.supabase.co",
  EXPECTED_SUPABASE_PROJECT_REF: "kriyjyyudngtibrtkylf", BLOCKED_SUPABASE_PROJECT_REFS: "kdigttaghqubfjsmbngl" };
const original = { bookstores: [{ id: 1, name: "public bookstore", unknown: { preserve: ["future"] }, updated_at: "2026-01-01T00:00:00.000Z" }],
  submissions: [{ id: 2, bookstore_id: 1, month: "2026-06", monthly_notice: "public notice", news: [], future: { v: 2 }, updated_at: "2026-01-01T00:00:00.000Z" }] };
const bookstore = () => ({ id: 101, name: "QA bookstore", introduction: "", future: { preserve: [1] } });
const submission = () => ({ id: 102, bookstore_id: 101, month: "2026-11", monthly_notice: "QA notice",
  news: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, title: `QA news ${index + 1}`, images: [] })), future: { preserve: "yes" } });
const writes = (fake) => fake.calls.filter((call) => call.method !== "GET");

async function setup(seed = original, options = {}) {
  const fake = createMemorySupabaseMock(seed);
  const adapter = await createMockOnlySupabaseAdapter({ target, mockFetch: fake.mockFetch, runId: "retain-run", ...options });
  return { fake, adapter };
}
function assertOriginal(fake) {
  for (const table of ["bookstores", "submissions"]) {
    assert.equal(canonical(fake.rows(table).filter((row) => row.id < 100)), canonical(original[table]));
  }
}

test("installed SDK creates one bookstore and one five-news submission, CAS-updates, reads, and RETAINS them", async () => {
  const { fake, adapter } = await setup();
  await adapter.captureBaseline();
  const book = await adapter.createBookstore(bookstore());
  const sub = await adapter.createSubmission(submission());
  const news = sub.row.news.map((item, index) => ({ ...item, title: `updated ${index}` }));
  const updated = await adapter.update(sub.handle, { news, monthly_notice: "updated notice" });
  assert.notEqual(updated.updated_at, sub.row.updated_at);
  assert.equal(updated.news.length, 5);
  assert.deepEqual(updated.future, { preserve: "yes" });
  assert.deepEqual(await adapter.read(sub.handle), updated);
  assert.equal(adapter.record(sub.handle).updates.length, 1);
  await adapter.assertBaseline();
  assert.throws(() => adapter.cleanup(), /RETAIN_ONLY_DELETION_UNSUPPORTED/);
  assert.equal(adapter.delete, undefined);
  assert.equal(fake.rows("bookstores").length, 2);
  assert.equal(fake.rows("submissions").length, 2);
  assert.ok(book.row.name.includes(qaMarker("retain-run")));
  assertOriginal(fake);
  assert.equal(fake.calls.some((call) => call.method === "DELETE"), false);
});

test("real SDK URL/method/returning/body/CAS filters and fixed fake credentials are exercised", async () => {
  const { fake, adapter } = await setup();
  await adapter.captureBaseline();
  await adapter.createBookstore(bookstore());
  const sub = await adapter.createSubmission(submission());
  await adapter.update(sub.handle, { monthly_notice: "second" });
  const mutations = writes(fake);
  assert.deepEqual(mutations.map((call) => call.method), ["POST", "POST", "PATCH"]);
  for (const call of fake.calls) {
    assert.equal(new URL(call.url).origin, target.SUPABASE_URL);
    assert.equal(call.redirect, "error");
    assert.equal(call.headers.apikey, "synthetic-fixed-fake-key-not-valid-for-live-supabase");
  }
  for (const call of mutations) {
    assert.match(call.headers.prefer, /return=representation/);
    assert.equal(new URL(call.url).searchParams.get("select"), "*");
  }
  const patch = mutations[2];
  const filters = new URL(patch.url).searchParams;
  assert.equal(filters.get("id"), "eq.102");
  assert.equal(filters.get("updated_at"), `eq.${sub.row.updated_at}`);
  assert.equal(filters.get("bookstore_id"), "eq.101");
  assert.equal(filters.get("month"), "eq.2026-11");
  assert.equal(filters.get("monthly_notice"), `eq.${sub.row.monthly_notice}`);
  assert.deepEqual(patch.body.future, { preserve: "yes" });
  assert.equal(Object.hasOwn(patch.body, "updated_at"), false);
  assertOriginal(fake);
});

test("missing/global fetch, key inputs and unsafe target configs refuse before any HTTP", async () => {
  const fake = createMemorySupabaseMock();
  for (const options of [
    { target, runId: "run" }, { target, runId: "run", mockFetch: globalThis.fetch },
    { target, runId: "run", mockFetch: fake.mockFetch, apiKey: "forbidden" },
    { target: { ...target, APP_ENV: "production" }, runId: "run", mockFetch: fake.mockFetch },
    { target: { ...target, SUPABASE_URL: "https://never-follow.invalid" }, runId: "run", mockFetch: fake.mockFetch },
  ]) await assert.rejects(createMockOnlySupabaseAdapter(options));
  assert.deepEqual(fake.calls, []);
});

test("complete paginated baseline and exact ID absence protect original rows", async () => {
  const { fake, adapter } = await setup(original, { pageSize: 1 });
  await adapter.captureBaseline();
  await assert.rejects(adapter.createBookstore({ ...bookstore(), id: 1 }), /ID_COLLISION/);
  assert.equal(writes(fake).length, 0);
  assertOriginal(fake);
  assert.ok(fake.calls.every((call) => [null, "0"].includes(new URL(call.url).searchParams.get("offset"))));
  const exact = await setup(original, { pageSize: 1, maxPages: 1 });
  await exact.adapter.captureBaseline(); // Count proves completion even on a full page.
  const seed = { ...original, bookstores: [...original.bookstores, { ...original.bookstores[0], id: 3 }] };
  const limited = await setup(seed, { pageSize: 1, maxPages: 1 });
  await assert.rejects(limited.adapter.captureBaseline(), /PAGINATION_INCOMPLETE/);
  assert.equal(writes(limited.fake).length, 0);
});

test("missing pagination count and changed baseline are fail-closed before writes", async () => {
  const missing = await setup();
  missing.fake.faultNext({ method: "GET", mode: "missing-count" });
  await assert.rejects(missing.adapter.captureBaseline(), /PAGINATION_UNCONFIRMED/);
  assert.equal(writes(missing.fake).length, 0);
  const changed = await setup();
  await changed.adapter.captureBaseline();
  changed.fake.mutate("bookstores", 1, { unknown: { changedBySomeoneElse: true } });
  await assert.rejects(changed.adapter.createBookstore(bookstore()), /BASELINE_CHANGED/);
  assert.equal(writes(changed.fake).length, 0);
});

test("failed/lost/null/empty/204 creation responses become terminal uncertain; no automatic removal", async () => {
  for (const mode of ["error", "throw", "lost", "null", "empty", "204"]) {
    const { fake, adapter } = await setup();
    await adapter.captureBaseline();
    fake.faultNext({ method: "POST", mode });
    await assert.rejects(adapter.createBookstore(bookstore()), /CREATE_UNCERTAIN/);
    assert.equal(adapter.records()[0].state, "uncertain");
    await assert.rejects(adapter.createBookstore({ ...bookstore(), id: 999 }), /LEDGER_NOT_CONFIRMED/);
    assert.equal(writes(fake).length, 1);
    assertOriginal(fake);
  }
});

test("CAS conflict/lost/malformed acknowledgements cannot advance revision; read cannot promote uncertain", async () => {
  for (const fault of [{ mode: "error" }, { mode: "lost" }, { mode: "empty" }, { mode: "204" },
    { transform: (rows) => rows.map((row) => ({ ...row, monthly_notice: "marker missing" })) },
    { transform: (rows) => rows.map((row) => ({ ...row, bookstore_id: 999 })) },
    { transform: (rows) => rows.map((row) => ({ ...row, month: "2026-06" })) }]) {
    const { fake, adapter } = await setup();
    await adapter.captureBaseline(); await adapter.createBookstore(bookstore());
    const sub = await adapter.createSubmission(submission());
    fake.faultNext({ method: "PATCH", ...fault });
    await assert.rejects(adapter.update(sub.handle, { monthly_notice: "new" }), /UPDATE_UNCERTAIN/);
    assert.equal(adapter.record(sub.handle).state, "uncertain");
    assert.equal(adapter.record(sub.handle).latest.updated_at, sub.row.updated_at);
    await adapter.read(sub.handle);
    assert.equal(adapter.record(sub.handle).state, "uncertain");
    await assert.rejects(adapter.update(sub.handle, { monthly_notice: "again" }), /LEDGER_NOT_CONFIRMED/);
    assertOriginal(fake);
  }
});

test("concurrent revision drift is never adopted from reads", async () => {
  const { fake, adapter } = await setup(); await adapter.captureBaseline();
  const book = await adapter.createBookstore(bookstore());
  fake.mutate("bookstores", 101, { updated_at: "2026-11-05T00:00:00.000Z" });
  await assert.rejects(adapter.update(book.handle, { introduction: "new" }), /OWNED_ROW_CHANGED/);
  assert.equal(adapter.record(book.handle).state, "uncertain");
  assert.equal(writes(fake).length, 1);
  assertOriginal(fake);
});

test("SDK accepts fake HTTP 206 with correct ranges and stops at exact count (not a SQL schema test)", async () => {
  const seed = { ...original, bookstores: [1, 3, 4].map((id) => ({ ...original.bookstores[0], id })) };
  const fake = createMemorySupabaseMock(seed);
  const responses = [];
  const mockFetch = async (url, init) => {
    const response = await fake.mockFetch(url, init);
    responses.push({ path: new URL(url).pathname, status: response.status, range: response.headers.get("content-range") });
    return response;
  };
  const adapter = await createMockOnlySupabaseAdapter({ target, mockFetch, runId: "partial", pageSize: 2, maxPages: 2 });
  const baseline = await adapter.captureBaseline();
  assert.equal(baseline.bookstores.length, 3);
  assert.deepEqual(responses.filter((response) => response.path.endsWith("/bookstores")), [
    { path: "/rest/v1/bookstores", status: 206, range: "0-1/3" },
    { path: "/rest/v1/bookstores", status: 206, range: "2-2/3" },
  ]);
  assert.equal(fake.calls.some((call) => new URL(call.url).searchParams.get("offset") === "4"), false);
  assert.equal(writes(fake).length, 0);
});

test("adapter single-flight locks capture/create/update before awaits and releases after completion", async () => {
  const { fake, adapter } = await setup(original, { runId: "retain_run" });
  const capture = adapter.captureBaseline();
  await assert.rejects(adapter.captureBaseline(), /ADAPTER_BUSY/);
  await capture;
  const creating = adapter.createBookstore(bookstore());
  await assert.rejects(adapter.createBookstore({ ...bookstore(), id: 999 }), /ADAPTER_BUSY/);
  const book = await creating;
  assert.equal(fake.rows("bookstores").filter((row) => row.id >= 100).length, 1);
  assert.equal(writes(fake).filter((call) => call.method === "POST").length, 1);
  const updating = adapter.update(book.handle, { name: "new full name" });
  await assert.rejects(adapter.update(book.handle, { name: "competing name" }), /ADAPTER_BUSY/);
  await updating;
  const patch = writes(fake).find((call) => call.method === "PATCH");
  assert.equal(new URL(patch.url).searchParams.get("name"), `eq.${book.row.name}`);
  assert.match(patch.body.name, /new full name/);
  await assert.rejects(adapter.createBookstore({ ...bookstore(), id: 999 }), /FIXTURE_LIMIT_REACHED/);
  assert.equal(writes(fake).length, 2);
  assertOriginal(fake);
});

test("create/update use immutable caller snapshots across delayed GETs, separate from DB TOCTOU", async () => {
  const fake = createMemorySupabaseMock(original);
  let gate = null;
  const mockFetch = async (url, init) => {
    if (gate && (init.method ?? "GET") === "GET") {
      const pending = gate; gate = null; pending.enter(); await pending.wait;
    }
    return fake.mockFetch(url, init);
  };
  function delayNextGet() {
    let release;
    let enter;
    const reached = new Promise((resolve) => { enter = resolve; });
    const wait = new Promise((resolve) => { release = resolve; });
    gate = { enter, wait };
    return { reached, release };
  }
  const adapter = await createMockOnlySupabaseAdapter({ target, mockFetch, runId: "snapshot" });
  await adapter.captureBaseline();
  const book = await adapter.createBookstore(bookstore());
  const input = submission();
  const createGate = delayNextGet();
  const creating = adapter.createSubmission(input);
  await createGate.reached;
  input.news[0].photos = ["must-not-be-sent"];
  input.news[0].images.push("must-not-be-sent");
  input.addedAfterAwait = "must-not-be-sent";
  input.future.preserve = "changed-after-await";
  createGate.release();
  const sub = await creating;
  assert.equal(Object.hasOwn(sub.row, "addedAfterAwait"), false);
  assert.equal(Object.hasOwn(sub.row.news[0], "photos"), false);
  assert.deepEqual(sub.row.news[0].images, []);
  assert.deepEqual(sub.row.future, { preserve: "yes" });
  const patch = { news: structuredClone(sub.row.news), monthly_notice: "initial snapshot notice" };
  const updateGate = delayNextGet();
  const updating = adapter.update(sub.handle, patch);
  await updateGate.reached;
  patch.news[0].photos = ["must-not-be-sent"];
  patch.news[0].images.push("must-not-be-sent");
  patch.addedAfterAwait = "must-not-be-sent";
  patch.monthly_notice = "caller-mutated";
  updateGate.release();
  const updated = await updating;
  assert.match(updated.monthly_notice, /initial snapshot notice/);
  assert.equal(Object.hasOwn(updated, "addedAfterAwait"), false);
  assert.equal(Object.hasOwn(updated.news[0], "photos"), false);
  assert.deepEqual(updated.news[0].images, []);
  const callCount = fake.calls.length;
  await assert.rejects(adapter.createBookstore({ ...bookstore(), nonJson: undefined }), /LEDGER_NON_JSON_VALUE/);
  await assert.rejects(adapter.update(book.handle, { introduction: undefined }), /LEDGER_NON_JSON_VALUE/);
  assert.equal(fake.calls.length, callCount, "non-JSON snapshots reject before reads or mutations");
  assertOriginal(fake);
});

test("photos, unsupported tables/months, and redirects have no mutation path; legacy block remains", async () => {
  const { fake, adapter } = await setup();
  await assert.rejects(adapter.createUnsupported("storage"), /TABLE_OR_STORAGE_UNSUPPORTED/);
  for (const table of ["news_schedule_ranges", "editing_leases", "improvement_requests", "monthly_digests"]) {
    await assert.rejects(adapter.rows(table), /TABLE_UNSUPPORTED/);
  }
  await assert.rejects(adapter.createBookstore({ ...bookstore(), images: ["unsupported"] }), /PHOTOS_UNSUPPORTED/);
  assert.deepEqual(fake.calls, []);
  await adapter.captureBaseline(); await adapter.createBookstore(bookstore());
  await assert.rejects(adapter.createSubmission({ ...submission(), month: "2026-06" }), /LEDGER_LINEAGE_REJECTED/);
  assert.equal(writes(fake).length, 1);
  fake.faultNext({ method: "GET", mode: "redirect" });
  await assert.rejects(adapter.rows("bookstores"), /SDK_RESPONSE_UNCONFIRMED/);
  assert.throws(() => assertLegacyIntegrationBlocked(), /SUPABASE_INTEGRATION_BLOCKED/);
  assertOriginal(fake);
});
