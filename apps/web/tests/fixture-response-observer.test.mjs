import assert from "node:assert/strict";
import test from "node:test";
import { installFixtureResponseObserver } from "./helpers/fixture-response-observer.mjs";

const ORIGIN = "https://html-copy.fixture.invalid";
function fixture(fetch) {
  const target = { fetch, Request, location: { href: `${ORIGIN}/` }, performance };
  installFixtureResponseObserver({ origin: ORIGIN }, target);
  return target;
}
async function observed(target) {
  const deadline = performance.now() + 1000;
  while (target.__fixtureFetchDiagnostics.some((entry) => entry.observerState === "pending") && performance.now() < deadline) {
    await new Promise((done) => setTimeout(done, 5));
  }
  assert.ok(target.__fixtureFetchDiagnostics.every((entry) => entry.observerState !== "pending"));
  return target.__fixtureFetchDiagnostics;
}
function mock204(bytes, overrides = {}) {
  return { status: 204, ok: true, body: {}, clone: () => ({ body: new ReadableStream({
    start(controller) { if (bytes.length) controller.enqueue(Uint8Array.from(bytes)); controller.close(); },
  }) }), ...overrides };
}

test("matching empty 204 preserves original Promise, Response, arguments and receiver", async () => {
  const response = new Response(null, { status: 204 }), original = Promise.resolve(response);
  const input = "/api/session", options = { method: "DELETE" };
  let target;
  target = fixture(function (...args) { assert.equal(this, target); assert.deepEqual(args, [input, options]); return original; });
  const result = target.fetch(input, options);
  assert.equal(result, original);
  assert.equal(await result, response);
  assert.deepEqual((await observed(target)).map(({ state, observerState, status, byteLength }) => ({ state, observerState, status, byteLength })),
    [{ state: "resolved", observerState: "completed", status: 204, byteLength: 0 }]);
  assert.equal(response.bodyUsed, false);
  assert.equal(target.__fixtureResponseObserverErrors, 0);
});

test("all exact allowed origin/method/path combinations are observed, including Request input", async () => {
  for (const [method, path, status] of [["GET", "workspace", 200], ["GET", "session", 200], ["POST", "session", 200],
    ["DELETE", "session", 204], ["POST", "presence", 200], ["DELETE", "presence", 204]]) {
    const target = fixture(async () => new Response(status === 204 ? null : "{}", { status }));
    await target.fetch(new Request(`${ORIGIN}/api/${path}`, { method }));
    const [entry] = await observed(target);
    assert.equal(entry.method, method);
    assert.equal(entry.pathname, `/api/${path}`);
    assert.equal(entry.byteLength, status === 204 ? 0 : 2);
    assert.equal(target.__fixtureResponseObserverErrors, 0);
  }
});

test("nonmatching origin, method or path leaves response completely untouched", async () => {
  const response = { clone() { assert.fail("nonmatching response must not be cloned"); } };
  for (const [url, method] of [["https://elsewhere.invalid/api/session", "DELETE"], [`${ORIGIN}/api/session`, "PUT"],
    [`${ORIGIN}/api/unknown`, "DELETE"], [`${ORIGIN}/api/session/`, "DELETE"]]) {
    const original = Promise.resolve(response), target = fixture(() => original);
    assert.equal(target.fetch(url, { method }), original);
    assert.equal(await original, response);
    assert.deepEqual(target.__fixtureFetchDiagnostics, []);
    assert.equal(target.__fixtureResponseObserverErrors, 0);
  }
});

test("nonempty 204, including UTF-8 BOM bytes, fails observation without normalizing response", async () => {
  for (const bytes of [[1], [0xef, 0xbb, 0xbf]]) {
    const response = mock204(bytes), target = fixture(async () => response);
    assert.equal(await target.fetch("/api/presence", { method: "DELETE" }), response);
    const [entry] = await observed(target);
    assert.equal(entry.observerError, "nonempty-204");
    assert.equal(entry.byteLength, bytes.length);
    assert.equal(target.__fixtureResponseObserverErrors, 1);
  }
});

test("synthetic network rejection remains rejected and fails the observer", async () => {
  const failure = new TypeError("synthetic network failure"), original = Promise.reject(failure);
  const target = fixture(() => original), result = target.fetch("/api/session", { method: "DELETE" });
  assert.equal(result, original);
  await assert.rejects(result, (error) => error === failure);
  const [entry] = await observed(target);
  assert.equal(entry.state, "rejected");
  assert.equal(entry.observerError, "fetch-rejected");
  assert.equal(target.__fixtureResponseObserverErrors, 1);
});

test("synchronous native failure is rethrown and fails the observer", async () => {
  const failure = new TypeError("synthetic synchronous failure"), target = fixture(() => { throw failure; });
  assert.throws(() => target.fetch("/api/session", { method: "DELETE" }), (error) => error === failure);
  assert.equal((await observed(target))[0].observerError, "fetch-threw");
  assert.equal(target.__fixtureResponseObserverErrors, 1);
});

test("clone and drain failures are visible failures, never silent successful observations", async () => {
  for (const [stage, clone] of [["clone-failed", () => { throw new Error("synthetic clone failure"); }],
    ["drain-failed", () => ({ body: new ReadableStream({ start(controller) { controller.error(new Error("synthetic drain failure")); } }) })]]) {
    const response = mock204([], { clone }), target = fixture(async () => response);
    assert.equal(await target.fetch("/api/session", { method: "DELETE" }), response);
    assert.equal((await observed(target))[0].observerError, stage);
    assert.equal(target.__fixtureResponseObserverErrors, 1);
  }
});

test("unexpected 500 is neither normalized nor hidden by observer", async () => {
  const response = new Response("synthetic failure", { status: 500 }), target = fixture(async () => response);
  assert.equal(await target.fetch("/api/session", { method: "DELETE" }), response);
  const [entry] = await observed(target);
  assert.equal(entry.status, 500);
  assert.equal(entry.observerError, "unexpected-status");
  assert.equal(response.bodyUsed, false);
  assert.equal(target.__fixtureResponseObserverErrors, 1);
});

test("200 observer drain leaves original application body readable and unchanged", async () => {
  const response = new Response("synthetic payload"), target = fixture(async () => response);
  const received = await target.fetch("/api/session", { method: "POST" });
  assert.equal(received, response);
  assert.equal((await observed(target))[0].byteLength, 17);
  assert.equal(response.bodyUsed, false);
  assert.equal(await received.text(), "synthetic payload");
});

test("observer cannot be installed against a real origin", () => {
  assert.throws(() => installFixtureResponseObserver({ origin: "https://example.com" }, {}), /synthetic/);
});

test("oversized fixture response fails bounded byte observation", async () => {
  const response = new Response(new Uint8Array(1024 * 1024 + 1)), target = fixture(async () => response);
  assert.equal(await target.fetch("/api/workspace"), response);
  assert.equal((await observed(target))[0].observerError, "body-limit-exceeded");
  assert.equal(target.__fixtureResponseObserverErrors, 1);
  assert.equal(response.bodyUsed, false);
});
