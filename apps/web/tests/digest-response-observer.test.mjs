import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installDigestResponseObserver } from "./helpers/digest-response-observer.mjs";

const ORIGIN = "https://digest.fixture.invalid";
function fixture(fetch, options = {}) {
  const target = { fetch, Request, location: { href: `${ORIGIN}/` } };
  installDigestResponseObserver({ origin: ORIGIN, ...options }, target);
  return target;
}
async function observed(target) {
  const deadline = performance.now() + 1_000;
  while (target.__digestFetchDiagnostics.some((item) => item.observerState === "pending") && performance.now() < deadline) {
    await new Promise((done) => setTimeout(done, 2));
  }
  assert.ok(target.__digestFetchDiagnostics.every((item) => item.observerState !== "pending"));
  return target.__digestFetchDiagnostics;
}
const snapshot = (record) => {
  const { state, observerState, status, byteLength, reason } = record;
  return { state, observerState, status, byteLength, ...(reason ? { reason } : {}) };
};

test("DORDER-OBS-01 original fetch Promise/Response/arguments/receiver are unchanged for200/204", async () => {
  for (const [method, pathname, status, body] of [["POST", "/api/session", 200, "{}"], ["DELETE", "/api/presence", 204, null]]) {
    const response = new Response(body, { status }), original = Promise.resolve(response);
    const options = { method };
    let target;
    target = fixture(function (...args) { assert.equal(this, target); assert.deepEqual(args, [pathname, options]); return original; });
    assert.equal(target.fetch(pathname, options), original);
    assert.equal(await original, response);
    assert.deepEqual(snapshot((await observed(target))[0]), { state: "resolved", observerState: "completed", status, byteLength: body === null ? 0 : 2 });
    assert.equal(response.bodyUsed, false);
    assert.equal(target.__digestObserverErrors, 0);
  }
});

test("DORDER-OBS-02 default true covers every existing exact method/path including dedicated order", async () => {
  for (const [method, pathname, status] of [["GET", "workspace", 200], ["GET", "session", 200], ["POST", "session", 200],
    ["DELETE", "session", 204], ["POST", "presence", 200], ["DELETE", "presence", 204], ["PUT", "submissions", 200],
    ["GET", "digest-order", 200], ["PUT", "digest-order", 200]]) {
    const target = fixture(async () => new Response(status === 204 ? null : "{}", { status }));
    await target.fetch(new Request(`${ORIGIN}/api/${pathname}?month=2026-11`, { method }));
    const [entry] = await observed(target);
    assert.equal(entry.method, method); assert.equal(entry.pathname, `/api/${pathname}`);
    assert.equal(entry.status, status); assert.equal(entry.observerState, "completed");
    assert.equal(target.__digestObserverErrors, 0);
  }
});

test("DORDER-OBS-03 observeOrderfalse excludes only order while retaining general failure observation", async () => {
  const untouched = { clone() { assert.fail("intentionally excluded order response must not be cloned"); } };
  for (const method of ["GET", "PUT"]) {
    const original = Promise.resolve(untouched), target = fixture(() => original, { observeOrder: false });
    assert.equal(target.fetch("/api/digest-order?month=2026-11", { method }), original);
    assert.equal(await original, untouched);
    assert.deepEqual(target.__digestFetchDiagnostics, []);
  }
  for (const [method, pathname] of [["GET", "workspace"], ["POST", "session"], ["DELETE", "presence"], ["PUT", "submissions"]]) {
    const target = fixture(async () => new Response("synthetic failure", { status: 500 }), { observeOrder: false });
    await target.fetch(`/api/${pathname}`, { method });
    const [entry] = await observed(target);
    assert.equal(entry.reason, "unexpected-status");
    assert.equal(target.__digestObserverErrors, 1, "disabling order observation must never suppress unrelated API failures");
  }
});

test("DORDER-OBS-04 option is strict boolean and origin is synthetic-only", () => {
  for (const observeOrder of [null, 0, 1, "false", {}, []]) {
    assert.throws(() => installDigestResponseObserver({ origin: ORIGIN, observeOrder }, {}), /must be boolean/);
  }
  assert.throws(() => installDigestResponseObserver({ origin: "https://example.com" }, {}), /Only digest fixture/);
});

test("DORDER-OBS-05 nonmatching origin/method/path leaves response untouched", async () => {
  const response = { clone() { assert.fail("unrelated response must not be cloned"); } };
  for (const [url, method] of [["https://other.fixture.invalid/api/session", "POST"], ["/api/session", "PUT"],
    ["/api/unknown", "GET"], ["/api/presence/", "DELETE"]]) {
    const original = Promise.resolve(response), target = fixture(() => original);
    assert.equal(target.fetch(url, { method }), original);
    assert.equal(await original, response);
    assert.deepEqual(target.__digestFetchDiagnostics, []);
    assert.equal(target.__digestObserverErrors, 0);
  }
});

test("DORDER-OBS-06 wrong successful or failed HTTP status is visible, never normalized", async () => {
  for (const status of [201, 204, 400, 500]) {
    const response = new Response(status === 204 ? null : "synthetic failure", { status });
    const target = fixture(async () => response);
    assert.equal(await target.fetch("/api/workspace"), response);
    const [entry] = await observed(target);
    assert.equal(entry.status, status); assert.equal(entry.reason, "unexpected-status");
    assert.equal(target.__digestObserverErrors, 1);
    assert.equal(response.bodyUsed, false);
  }
});

test("DORDER-OBS-07 clone/read failures are failed observations without altering application response", async () => {
  for (const clone of [() => { throw new Error("synthetic clone failure"); }, () => ({ body: new ReadableStream({
    start(controller) { controller.error(new Error("synthetic read failure")); },
  }) })]) {
    const response = { status: 200, ok: true, clone }, target = fixture(async () => response);
    assert.equal(await target.fetch("/api/workspace"), response);
    assert.equal((await observed(target))[0].reason, "clone-drain-failed");
    assert.equal(target.__digestObserverErrors, 1);
  }
});

test("DORDER-OBS-08 byte cap allows exact1MiB and rejects one byte beyond", async () => {
  for (const size of [1024 * 1024, 1024 * 1024 + 1]) {
    const response = new Response(new Uint8Array(size)), target = fixture(async () => response);
    assert.equal(await target.fetch("/api/workspace"), response);
    const [entry] = await observed(target);
    assert.equal(entry.byteLength, size);
    assert.equal(entry.observerState, size === 1024 * 1024 ? "completed" : "failed");
    assert.equal(entry.reason, size === 1024 * 1024 ? undefined : "invalid-body-size");
    assert.equal(target.__digestObserverErrors, size === 1024 * 1024 ? 0 : 1);
    assert.equal(response.bodyUsed, false);
  }
});

test("DORDER-OBS-09 nonempty204 is rejected by byte count including UTF8BOM", async () => {
  for (const bytes of [[1], [0xef, 0xbb, 0xbf]]) {
    const response = { status: 204, ok: true, clone: () => ({ body: new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.from(bytes)); controller.close();
    } }) }) };
    const target = fixture(async () => response);
    assert.equal(await target.fetch("/api/presence", { method: "DELETE" }), response);
    const [entry] = await observed(target);
    assert.equal(entry.reason, "invalid-body-size"); assert.equal(entry.byteLength, bytes.length);
    assert.equal(target.__digestObserverErrors, 1);
  }
});

test("DORDER-OBS-10 native rejection and synchronous throw preserve original failure identity", async () => {
  const failure = new Error("synthetic failure"), original = Promise.reject(failure);
  const rejected = fixture(() => original), result = rejected.fetch("/api/session", { method: "POST" });
  assert.equal(result, original);
  await assert.rejects(result, (error) => error === failure);
  assert.equal((await observed(rejected))[0].reason, "fetch-rejected");
  assert.equal(rejected.__digestObserverErrors, 1);
  const thrown = fixture(() => { throw failure; });
  assert.throws(() => thrown.fetch("/api/presence", { method: "DELETE" }), (error) => error === failure);
  const [entry] = await observed(thrown);
  assert.equal(entry.state, "threw"); assert.equal(entry.reason, "fetch-threw");
  assert.equal(thrown.__digestObserverErrors, 1);
});

test("DORDER-OBS-11 body remains application-readable and diagnostics are defensive snapshots", async () => {
  const body = "첫째 줄 📚\n둘째 줄", response = new Response(body), target = fixture(async () => response);
  const received = await target.fetch("/api/workspace");
  const entries = await observed(target);
  assert.equal(entries[0].byteLength, new TextEncoder().encode(body).byteLength);
  entries[0].observerState = "tampered";
  assert.equal(target.__digestFetchDiagnostics[0].observerState, "completed");
  assert.equal(response.bodyUsed, false); assert.equal(await received.text(), body);
});

test("DORDER-OBS-12 lifecycle wires general response drains without relaxing exact cancellation checks", async () => {
  const [lifecycle, helper, positive] = await Promise.all([
    readFile(new URL("./browser-digest-lifecycle.mjs", import.meta.url), "utf8"),
    readFile(new URL("./helpers/built-ssr-fixture.mjs", import.meta.url), "utf8"),
    readFile(new URL("./browser-digest.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(helper, /!\("origin" in observerOptions\)/);
  assert.match(helper, /addInitScript\(observer, \{ \.\.\.observerOptions, origin \}\)/);
  assert.match(lifecycle, /observer: installDigestResponseObserver, observerOptions: \{ observeOrder: false \}/);
  assert.match(lifecycle, /OBSERVER-ERRORS-ZERO/); assert.match(lifecycle, /OBSERVED-RESPONSES-COMPLETE/);
  assert.match(lifecycle, /expected\.plans\.length === 3/);
  assert.match(lifecycle, /diagnostics\.counts\.transportFailures, expected\.expectedTransportAborts/);
  assert.match(positive, /import \{ installDigestResponseObserver \} from "\.\/helpers\/digest-response-observer\.mjs"/);
  assert.doesNotMatch(positive, /observeOrder: false/);
});
