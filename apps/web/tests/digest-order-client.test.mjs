import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDigestOrderClient, digestOrderAfterMove } from "../lib/digest-order-client.ts";

const month = "2026-11";
const request = (changes = {}) => ({ month, submissionIds: [2, 1], revision: 2, ...changes });
const order = (changes = {}) => ({ ...request(), revision: 3, updatedAt: "2026-11-04T12:00:00Z", ...changes });
const capability = (changes = {}) => ({ available: true, order: order(changes) });
const matches = (code) => (error) => error.code === code && !error.message.includes("PRIVATE");

function fixture(steps, timeoutMs = 100) {
  const calls = [];
  const client = createDigestOrderClient({
    timeoutMs, sessionHeaders: () => ({ "x-workspace-session-id": "synthetic-tab-only" }),
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      const next = steps.shift();
      assert.ok(next, "Unexpected extra HTTP request");
      return typeof next === "function" ? next(options) : Response.json(next.body, { status: next.status ?? 200 });
    },
  });
  return { client, calls };
}

test("DORDER-CLIENT-01 GET uses dedicated same-origin no-store API and injected tab headers", async () => {
  const { client, calls } = fixture([{ body: capability() }]);
  assert.deepEqual(await client.read(month), capability());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/digest-order?month=2026-11");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].cache, "no-store");
  assert.equal(calls[0].credentials, "same-origin");
  assert.equal(calls[0].headers["x-workspace-session-id"], "synthetic-tab-only");
});

test("DORDER-CLIENT-02 absent capability is distinct from malformed/foreign-month GET", async () => {
  const absent = fixture([{ body: { available: false } }]);
  assert.deepEqual(await absent.client.read(month), { available: false });
  for (const body of [null, {}, { available: false, extra: true }, capability({ month: "2026-12" })]) {
    const { client, calls } = fixture([{ body }]);
    await assert.rejects(client.read(month), matches("DIGEST_ORDER_STORAGE_FAILED"));
    assert.equal(calls.length, 1);
  }
});

test("DORDER-CLIENT-03 invalid month/payload/MAX_SAFE never reaches fetch", async () => {
  const { client, calls } = fixture([]);
  await assert.rejects(client.read("2026-11\n"), matches("INVALID_DIGEST_ORDER"));
  for (const value of [request({ submissionIds: [1, 1] }), request({ revision: Number.MAX_SAFE_INTEGER })]) {
    await assert.rejects(client.save(value), matches("INVALID_DIGEST_ORDER"));
  }
  assert.equal(calls.length, 0);
});

test("DORDER-CLIENT-04 exact write acknowledgement sends one immutable request", async () => {
  const source = request();
  let resume;
  const { client, calls } = fixture([() => new Promise((resolve) => { resume = () => resolve(Response.json(capability())); })]);
  const pending = client.save(source);
  source.submissionIds.reverse();
  source.revision = 99;
  resume();
  assert.deepEqual(await pending, { kind: "saved", order: order() });
  assert.deepEqual(JSON.parse(calls[0].body), request());
  assert.equal(calls.length, 1);
});

test("DORDER-CLIENT-05 401/403/423/400 stop immediately with fixed messages and no recovery GET", async () => {
  for (const [status, code] of [[401, "SESSION_REQUIRED"], [403, "HTML_ROLE_REQUIRED"], [423, "DIGEST_ORDER_LEASE_REQUIRED"], [400, "INVALID_DIGEST_ORDER"]]) {
    const { client, calls } = fixture([{ status, body: { error: "PRIVATE_SQL_HASH" } }]);
    await assert.rejects(client.save(request()), matches(code));
    assert.equal(calls.length, 1);
  }
});

test("DORDER-CLIENT-06 409 carries only validated same-month latest and never retries", async () => {
  for (const latest of [order(), order({ month: "2026-12" }), null]) {
    const { client, calls } = fixture([{ status: 409, body: { latest, error: "PRIVATE" } }]);
    await assert.rejects(client.save(request()), (error) => {
      assert.equal(error.code, "DIGEST_ORDER_CONFLICT");
      assert.deepEqual(error.latest, latest?.month === month ? latest : undefined);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("DORDER-CLIENT-07 lost PUT response performs one GET and confirms committed identical order", async () => {
  const { client, calls } = fixture([() => { throw new Error("PRIVATE_NETWORK"); }, { body: capability() }]);
  assert.deepEqual(await client.save(request()), { kind: "confirmed", order: order() });
  assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
});

test("DORDER-CLIENT-08 uncertain PUT with differing newer order returns conflict without PUT retry", async () => {
  const latest = order({ submissionIds: [1, 2], revision: 4 });
  const { client, calls } = fixture([{ status: 503, body: { error: "PRIVATE" } }, { body: { available: true, order: latest } }]);
  assert.deepEqual(await client.save(request()), { kind: "conflict", latest });
  assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
});

test("DORDER-CLIENT-09 unchanged/lower revision, absent, malformed or failed recovery remain unknown", async () => {
  for (const second of [{ body: capability({ revision: 2 }) }, { body: capability({ revision: 1 }) },
    { body: { available: false } }, { body: capability({ month: "2026-12" }) }, { status: 503, body: null },
    () => { throw new Error("PRIVATE"); }]) {
    const { client, calls } = fixture([() => { throw new Error("PRIVATE"); }, second]);
    assert.deepEqual(await client.save(request()), { kind: "unknown" });
    assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
  }
});

test("DORDER-CLIENT-10 valid-looking but wrong PUT acknowledgement is recovered, not accepted", async () => {
  for (const body of [capability({ revision: 2 }), capability({ revision: 4 }), capability({ submissionIds: [1, 2] }),
    capability({ submissionIds: [2] }), capability({ revision: 0, submissionIds: [], updatedAt: "" }),
    capability({ month: "2026-12" }), { available: false }, null]) {
    const { client, calls } = fixture([{ body }, { body: capability({ revision: 2 }) }]);
    assert.deepEqual(await client.save(request()), { kind: "unknown" });
    assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
  }
});

test("DORDER-CLIENT-11 timed-out GET aborts transport even if fetch ignores cancellation", async () => {
  const { client, calls } = fixture([() => new Promise(() => undefined)], 5);
  await assert.rejects(client.read(month), matches("DIGEST_ORDER_TIMEOUT"));
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 1);
});

test("DORDER-CLIENT-12 timed-out PUT only reads once, and recovery is bounded too", async () => {
  const { client, calls } = fixture([() => new Promise(() => undefined), () => new Promise(() => undefined)], 5);
  assert.deepEqual(await client.save(request()), { kind: "unknown" });
  assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
  assert.ok(calls.every((call) => call.signal.aborted));
});

test("DORDER-CLIENT-13 external cancel during PUT stops without recovery or retry", async () => {
  const abort = new AbortController();
  const { client, calls } = fixture([() => new Promise(() => undefined)]);
  const pending = client.save(request(), abort.signal);
  abort.abort();
  await assert.rejects(pending, matches("DIGEST_ORDER_CANCELLED"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});

test("DORDER-CLIENT-14 pre-aborted signal never reaches fetch", async () => {
  const abort = new AbortController(); abort.abort();
  const { client, calls } = fixture([]);
  await assert.rejects(client.read(month, abort.signal), matches("DIGEST_ORDER_CANCELLED"));
  await assert.rejects(client.save(request(), abort.signal), matches("DIGEST_ORDER_CANCELLED"));
  assert.equal(calls.length, 0);
});

test("DORDER-CLIENT-15 completed request removes abort listener and clears timeout", async () => {
  const abort = new AbortController();
  let added = 0, removed = 0;
  const originalAdd = abort.signal.addEventListener.bind(abort.signal);
  const originalRemove = abort.signal.removeEventListener.bind(abort.signal);
  abort.signal.addEventListener = (...args) => { added++; return originalAdd(...args); };
  abort.signal.removeEventListener = (...args) => { removed++; return originalRemove(...args); };
  const { client, calls } = fixture([{ body: capability() }], 5);
  await client.read(month, abort.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  abort.abort();
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(calls[0].signal.aborted, false);
});

test("DORDER-CLIENT-16 cancellation during recovery ignores even a late successful read", async () => {
  const abort = new AbortController();
  let readStarted;
  const started = new Promise((resolve) => { readStarted = resolve; });
  const { client, calls } = fixture([() => { throw new Error("lost"); }, () => {
    readStarted(); return new Promise(() => undefined);
  }]);
  const pending = client.save(request(), abort.signal);
  await started;
  abort.abort();
  await assert.rejects(pending, matches("DIGEST_ORDER_CANCELLED"));
  assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
});

test("DORDER-CLIENT-17 explicit reorder retains hidden drafts and appends newly completed deterministically", () => {
  const records = [
    { id: 1, month, status: "completed" }, { id: 2, month, status: "completed" },
    { id: 3, month, status: "draft" }, { id: 4, month, status: "completed" },
    { id: 5, month: "2026-12", status: "completed" },
  ];
  const saved = [2, 3, 1, 999, 5];
  const before = structuredClone({ records, saved });
  assert.deepEqual(digestOrderAfterMove(records, month, saved, 1, 2), [1, 3, 2, 4]);
  assert.deepEqual({ records, saved }, before);
  const completedAgain = records.map((item) => item.id === 3 ? { ...item, status: "completed" } : item);
  assert.deepEqual(digestOrderAfterMove(completedAgain, month, [1, 3, 2, 4], 4, 2), [1, 3, 4, 2]);
});

test("DORDER-CLIENT-18 boundary contracts: no server import, dedicated state, handle-only drag", async () => {
  const [client, hook, controller, panel, screen] = await Promise.all([
    readFile(new URL("../lib/digest-order-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/use-digest-order.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/use-studio-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/molecules/DigestOrderPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/organisms/HtmlWorkspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(client, /digest-order-(?:service|repository)|supabase|process\.env|workspace-client/);
  assert.match(hook, /const owned = await refreshPresence\(\);\s+if \(!current\(operation\)\) return;\s+if \(!owned\) throw/);
  assert.match(hook, /if \(busy\.current === operation\) busy\.current = null/);
  assert.match(hook, /useLayoutEffect/);
  assert.match(hook, /if \(state\.month !== scope\) \{\s+setState\(\{ month: scope, phase: "loading", order: null/);
  assert.match(hook, /digestOrderCanReorder: allowed && presenceOwned && selected\.phase === "ready"/);
  assert.match(hook, /result\.order\.revision === 0 \? "기본" : "저장된"/);
  assert.match(controller, /presenceOwned: editingPresence\.status === "owned"/);
  assert.match(controller, /digestHtml\(digestReady, bookstores, month\)/);
  assert.doesNotMatch(controller, /const reorderDigest =|monthIndexes|ordered\.splice/);
  assert.match(panel, /<button[^>]*className="digest-order-handle" draggable=\{digestOrderCanReorder\}/);
  assert.doesNotMatch(panel, /<article[^>]*\bdraggable/);
  assert.match(screen, /<DigestOrderPanel studio=\{studio\}/);
  // Source contracts do not prove mounted React races or real browser drag behavior.
});
