import assert from "node:assert/strict";
import test from "node:test";

import { createStagingGate } from "../worker/staging-gate.mjs";

const ORIGIN = "https://stage.example";
const PASSWORD = "staging-password";
const SECRET = "staging-session-secret-32-bytes!!";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1_000;

function context() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

function makeLimiter(result = { success: true }) {
  const calls = [];
  return {
    calls,
    async limit(input) {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    APP_ENV: "staging",
    STAGING_ACCESS_PASSWORD: PASSWORD,
    STAGING_SESSION_SECRET: SECRET,
    STAGING_LOGIN_LIMITER: makeLimiter(),
    ...overrides,
  };
}

function makeNext() {
  const calls = [];
  return {
    calls,
    handler: {
      async fetch(request, env, ctx) {
        calls.push({ request, env, ctx });
        return new Response("upstream", {
          status: 299,
          headers: { "x-upstream": "preserved" },
        });
      },
    },
  };
}

function request(path, init = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

function formHeaders(overrides = {}) {
  const headers = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "cf-connecting-ip": "203.0.113.9",
    origin: ORIGIN,
    ...overrides,
  };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete headers[name];
  }
  return headers;
}

function cookiePair(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "response must set the staging gate cookie");
  return setCookie.split(";", 1)[0];
}

async function login(gate, env, password = PASSWORD) {
  return gate.fetch(request("/__staging/login", {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ password }),
  }), env, context());
}

function assertNoSessionCookie(response) {
  assert.equal(response.headers.get("set-cookie"), null);
}

function assertPrivateResponse(response) {
  assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store\b/i);
}

test("STAGE-GATE-01 fails closed when required staging bindings are invalid", async () => {
  const cases = [
    ["missing APP_ENV", { APP_ENV: undefined }],
    ["wrong APP_ENV", { APP_ENV: "production" }],
    ["missing password", { STAGING_ACCESS_PASSWORD: undefined }],
    ["short password", { STAGING_ACCESS_PASSWORD: "x".repeat(15) }],
    ["blank password", { STAGING_ACCESS_PASSWORD: " ".repeat(16) }],
    ["oversized password", { STAGING_ACCESS_PASSWORD: "x".repeat(513) }],
    ["missing secret", { STAGING_SESSION_SECRET: undefined }],
    ["short secret", { STAGING_SESSION_SECRET: "x".repeat(31) }],
    ["blank secret", { STAGING_SESSION_SECRET: " ".repeat(32) }],
    ["oversized secret", { STAGING_SESSION_SECRET: "x".repeat(1025) }],
    ["shared password and secret", {
      STAGING_ACCESS_PASSWORD: "x".repeat(32),
      STAGING_SESSION_SECRET: "x".repeat(32),
    }],
  ];

  for (const [label, overrides] of cases) {
    const next = makeNext();
    const gate = createStagingGate(next.handler);
    const response = await gate.fetch(request("/", {
      headers: { accept: "text/html" },
    }), makeEnv(overrides), context());
    assert.equal(response.status, 503, label);
    assert.equal(next.calls.length, 0, label);
    assertNoSessionCookie(response);
    assertPrivateResponse(response);
  }
});

test("STAGE-GATE-02 serves only the exact login route and never exposes secrets", async () => {
  const next = makeNext();
  const gate = createStagingGate(next.handler);
  const env = makeEnv();

  const response = await gate.fetch(request("/__staging/login"), env, context());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assertPrivateResponse(response);
  const html = await response.text();
  assert.match(html, /<form\b[^>]*method=["']?post/i);
  assert.match(html, /action=["']\/__staging\/login["']/i);
  assert.match(html, /<input\b[^>]*type=["']password["']/i);
  assert.doesNotMatch(html, new RegExp(PASSWORD));
  assert.doesNotMatch(html, new RegExp(SECRET));
  assert.equal(next.calls.length, 0);

  for (const path of [
    "/__staging/login/",
    "/__staging/login.css",
    "/x/__staging/login",
    "/%5f%5fstaging/login",
  ]) {
    const denied = await gate.fetch(request(path, {
      headers: { accept: "text/css" },
    }), env, context());
    assert.equal(denied.status, 401, path);
  }

  const methodDenied = await gate.fetch(request("/__staging/login", {
    method: "PUT",
    headers: formHeaders(),
  }), env, context());
  assert.equal(methodDenied.status, 405);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-03 issues an eight-hour host cookie only after a limited correct login", async () => {
  const nowMs = Date.UTC(2026, 8, 29, 0, 0, 0);
  const next = makeNext();
  const limiter = makeLimiter();
  const env = makeEnv({ STAGING_LOGIN_LIMITER: limiter });
  const gate = createStagingGate(next.handler, { now: () => nowMs });
  const response = await login(gate, env);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assertPrivateResponse(response);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^__Host-staging_gate=[^;]+;/);
  assert.match(setCookie, /;\s*Path=\//i);
  assert.match(setCookie, /;\s*HttpOnly/i);
  assert.match(setCookie, /;\s*Secure/i);
  assert.match(setCookie, /;\s*SameSite=Strict/i);
  assert.match(setCookie, /;\s*Max-Age=28800\b/i);
  assert.doesNotMatch(setCookie, /;\s*Domain=/i);
  assert.doesNotMatch(setCookie, new RegExp(PASSWORD));
  assert.doesNotMatch(setCookie, new RegExp(SECRET));
  assert.deepEqual(limiter.calls, [{ key: "staging-login:203.0.113.9" }]);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-04 rejects wrong passwords without issuing a session", async () => {
  const next = makeNext();
  const limiter = makeLimiter();
  const env = makeEnv({ STAGING_LOGIN_LIMITER: limiter });
  const gate = createStagingGate(next.handler);
  const response = await login(gate, env, "incorrect-password");

  assert.equal(response.status, 401);
  assertNoSessionCookie(response);
  assertPrivateResponse(response);
  const body = await response.text();
  assert.doesNotMatch(body, /incorrect-password/);
  assert.doesNotMatch(body, new RegExp(SECRET));
  assert.deepEqual(limiter.calls, [{ key: "staging-login:203.0.113.9" }]);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-05 requires a trusted client IP and fails closed on limiter denial or failure", async () => {
  for (const [label, limiter, expectedStatus] of [
    ["limited", makeLimiter({ success: false }), 429],
    ["limiter exception", makeLimiter(new Error("limiter unavailable")), 503],
    ["malformed limiter response", makeLimiter({}), 503],
  ]) {
    const next = makeNext();
    const gate = createStagingGate(next.handler);
    const response = await login(gate, makeEnv({ STAGING_LOGIN_LIMITER: limiter }));
    assert.equal(response.status, expectedStatus, label);
    assertNoSessionCookie(response);
    assertPrivateResponse(response);
    assert.equal(next.calls.length, 0, label);
  }

  for (const [label, limiter] of [
    ["missing limiter", undefined],
    ["invalid limiter", {}],
  ]) {
    const next = makeNext();
    const gate = createStagingGate(next.handler);
    const response = await login(gate, makeEnv({ STAGING_LOGIN_LIMITER: limiter }));
    assert.equal(response.status, 503, label);
    assertNoSessionCookie(response);
    assert.equal(next.calls.length, 0, label);
  }

  const next = makeNext();
  const limiter = makeLimiter();
  const gate = createStagingGate(next.handler);
  const response = await gate.fetch(request("/__staging/login", {
    method: "POST",
    headers: formHeaders({ "cf-connecting-ip": undefined }),
    body: new URLSearchParams({ password: PASSWORD }),
  }), makeEnv({ STAGING_LOGIN_LIMITER: limiter }), context());
  assert.equal(response.status, 503);
  assert.equal(limiter.calls.length, 0);
  assertNoSessionCookie(response);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-06 rejects cross-origin login and logout before rate limiting", async () => {
  for (const origin of ["https://evil.example", "http://stage.example", "null", undefined]) {
    const next = makeNext();
    const limiter = makeLimiter();
    const env = makeEnv({ STAGING_LOGIN_LIMITER: limiter });
    const gate = createStagingGate(next.handler);
    const headers = formHeaders({ origin });

    for (const path of ["/__staging/login", "/__staging/logout"]) {
      const response = await gate.fetch(request(path, {
        method: "POST",
        headers,
        body: new URLSearchParams({ password: PASSWORD }),
      }), env, context());
      assert.equal(response.status, 403, `${origin ?? "missing"} ${path}`);
      assertNoSessionCookie(response);
      assertPrivateResponse(response);
    }
    assert.equal(limiter.calls.length, 0);
    assert.equal(next.calls.length, 0);
  }
});

test("STAGE-GATE-07 enforces form encoding, exact fields, and the 2048-byte body limit", async () => {
  const next = makeNext();
  const gate = createStagingGate(next.handler);
  const env = makeEnv();

  const wrongType = await gate.fetch(request("/__staging/login", {
    method: "POST",
    headers: formHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ password: PASSWORD }),
  }), env, context());
  assert.equal(wrongType.status, 415);
  assertNoSessionCookie(wrongType);

  const atLimit = await gate.fetch(request("/__staging/login", {
    method: "POST",
    headers: formHeaders(),
    body: `password=${"x".repeat(2039)}`,
  }), env, context());
  assert.equal(atLimit.status, 401);
  assertNoSessionCookie(atLimit);

  const tooLarge = await gate.fetch(request("/__staging/login", {
    method: "POST",
    headers: formHeaders(),
    body: `password=${"x".repeat(2040)}`,
  }), env, context());
  assert.equal(tooLarge.status, 413);
  assertNoSessionCookie(tooLarge);

  for (const body of [
    "password=one&password=two",
    `password=${PASSWORD}&unexpected=value`,
    "unexpected=value",
  ]) {
    const malformed = await gate.fetch(request("/__staging/login", {
      method: "POST",
      headers: formHeaders(),
      body,
    }), env, context());
    assert.equal(malformed.status, 400, body);
    assertNoSessionCookie(malformed);
  }
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-08 detects cookie tampering, ambiguity, and host replay", async () => {
  const nowMs = Date.UTC(2026, 8, 29, 0, 0, 0);
  const next = makeNext();
  const env = makeEnv();
  const gate = createStagingGate(next.handler, { now: () => nowMs });
  const session = cookiePair(await login(gate, env));
  const [name, value] = session.split("=");
  const [payload, signature] = value.split(".");
  const replacement = signature.startsWith("A") ? "B" : "A";
  const tampered = `${name}=${payload}.${replacement}${signature.slice(1)}`;

  for (const cookie of [
    tampered,
    `${name}=not-a-valid-session`,
    `prefix_${name}=${value}`,
    `${session}; ${tampered}`,
  ]) {
    const response = await gate.fetch(request("/api/session", {
      headers: { cookie },
    }), env, context());
    assert.equal(response.status, 401, cookie.slice(0, 40));
  }

  const replay = await gate.fetch(new Request("https://other.example/api/session", {
    headers: { cookie: session },
  }), env, context());
  assert.equal(replay.status, 401);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-09 expires sessions at the exact eight-hour boundary", async () => {
  let nowMs = Date.UTC(2026, 8, 29, 0, 0, 0);
  const next = makeNext();
  const env = makeEnv();
  const gate = createStagingGate(next.handler, { now: () => nowMs });
  const session = cookiePair(await login(gate, env));

  nowMs += EIGHT_HOURS_MS - 1;
  const beforeExpiry = await gate.fetch(request("/api/session", {
    headers: { cookie: session },
  }), env, context());
  assert.equal(beforeExpiry.status, 299);
  assert.equal(next.calls.length, 1);

  nowMs += 1;
  const atExpiry = await gate.fetch(request("/api/session", {
    headers: { cookie: session },
  }), env, context());
  assert.equal(atExpiry.status, 401);
  assert.equal(next.calls.length, 1);
});

test("STAGE-GATE-10 forwards every protected request only with a valid session", async () => {
  const nowMs = Date.UTC(2026, 8, 29, 0, 0, 0);
  const next = makeNext();
  const env = makeEnv();
  const ctx = context();
  const gate = createStagingGate(next.handler, { now: () => nowMs });
  const session = cookiePair(await login(gate, env));

  for (const [path, init] of [
    ["/", { headers: { cookie: `${session}; theme=dark`, accept: "text/html" } }],
    ["/api/session", { headers: { cookie: `${session}; theme=dark` } }],
    ["/_next/static/app.js", { headers: { cookie: session } }],
    ["/asset.css", { method: "HEAD", headers: { cookie: session } }],
    ["/api/submissions", { method: "POST", headers: { cookie: session }, body: "{}" }],
  ]) {
    const original = request(path, init);
    const response = await gate.fetch(original, env, ctx);
    assert.equal(response.status, 299, path);
    assert.equal(response.headers.get("x-upstream"), "preserved", path);
    assertPrivateResponse(response);
    const forwarded = next.calls.at(-1);
    assert.equal(forwarded.request.url, original.url, path);
    assert.equal(forwarded.request.method, original.method, path);
    assert.doesNotMatch(forwarded.request.headers.get("cookie") ?? "", /__Host-staging_gate=/, path);
    assert.strictEqual(forwarded.env, env, path);
    assert.strictEqual(forwarded.ctx, ctx, path);
  }
  assert.equal(next.calls.length, 5);
  assert.equal(next.calls[0].request.headers.get("cookie"), "theme=dark");
  assert.equal(next.calls[1].request.headers.get("cookie"), "theme=dark");
});

test("STAGE-GATE-11 clears the host cookie on same-origin POST logout only", async () => {
  const next = makeNext();
  const gate = createStagingGate(next.handler);
  const env = makeEnv();
  const response = await gate.fetch(request("/__staging/logout", {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams(),
  }), env, context());

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/__staging/login");
  assertPrivateResponse(response);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^__Host-staging_gate=;/);
  assert.match(setCookie, /;\s*Path=\//i);
  assert.match(setCookie, /;\s*HttpOnly/i);
  assert.match(setCookie, /;\s*Secure/i);
  assert.match(setCookie, /;\s*SameSite=Strict/i);
  assert.match(setCookie, /;\s*Max-Age=0\b/i);
  assert.doesNotMatch(setCookie, /;\s*Domain=/i);

  const getLogout = await gate.fetch(request("/__staging/logout"), env, context());
  assert.equal(getLogout.status, 200);
  assertNoSessionCookie(getLogout);
  assert.match(await getLogout.text(), /<form\b[^>]*method=["']?post[^>]*action=["']\/__staging\/logout["']/i);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-12 never redirects API, static, unsafe, or upgrade requests", async () => {
  const next = makeNext();
  const gate = createStagingGate(next.handler);
  const env = makeEnv();
  const denied = [
    ["/api/session", { headers: { accept: "text/html" } }],
    ["/_next/static/app.js", { headers: { accept: "text/html" } }],
    ["/_vinext/image?url=%2Fphoto.jpg", { headers: { accept: "image/avif,image/webp,*/*" } }],
    ["/styles.css", { headers: { accept: "text/html" } }],
    ["/favicon.ico", { headers: { accept: "image/*" } }],
    ["/", { method: "POST", headers: { accept: "text/html" }, body: "x" }],
    ["/", { method: "OPTIONS", headers: { origin: "https://evil.example" } }],
    ["/socket", { headers: { accept: "text/html", upgrade: "websocket" } }],
    ["/help", { method: "HEAD", headers: { accept: "text/html" } }],
  ];

  for (const [path, init] of denied) {
    const response = await gate.fetch(request(path, init), env, context());
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("location"), null, path);
    assertNoSessionCookie(response);
    assertPrivateResponse(response);
  }

  const response = await gate.fetch(request("/help?month=2026-09", {
    headers: { accept: "text/html" },
  }), env, context());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/__staging/login");
  assertPrivateResponse(response);
  assert.equal(next.calls.length, 0);
});

test("STAGE-GATE-13 preserves upstream 404 cookies and converts upstream failures to a generic 500", async () => {
  const nowMs = Date.UTC(2026, 8, 29, 0, 0, 0);
  let mode = "response";
  let calls = 0;
  const next = {
    async fetch() {
      calls += 1;
      if (mode === "throw") throw new Error("sensitive upstream failure detail");
      const headers = new Headers();
      headers.append("set-cookie", "first=one; Path=/; HttpOnly");
      headers.append("set-cookie", "second=two; Path=/; SameSite=Lax");
      return new Response("upstream not found", { status: 404, headers });
    },
  };
  const env = makeEnv();
  const gate = createStagingGate(next, { now: () => nowMs });
  const session = cookiePair(await login(gate, env));

  const notFound = await gate.fetch(request("/missing", {
    headers: { cookie: session },
  }), env, context());
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), "upstream not found");
  assert.deepEqual(notFound.headers.getSetCookie(), [
    "first=one; Path=/; HttpOnly",
    "second=two; Path=/; SameSite=Lax",
  ]);
  assertPrivateResponse(notFound);

  mode = "throw";
  const failed = await gate.fetch(request("/api/session", {
    headers: { cookie: session },
  }), env, context());
  assert.equal(failed.status, 500);
  assertPrivateResponse(failed);
  assertNoSessionCookie(failed);
  const body = await failed.text();
  assert.doesNotMatch(body, /sensitive upstream failure detail/i);
  assert.doesNotMatch(body, new RegExp(PASSWORD));
  assert.doesNotMatch(body, new RegExp(SECRET));
  assert.equal(calls, 2);
});

test("STAGE-GATE-14 blocks the vinext image endpoint before upstream even with a valid session", async () => {
  const nowMs = Date.UTC(2026, 8, 29, 0, 0, 0);
  const next = makeNext();
  const env = makeEnv();
  const gate = createStagingGate(next.handler, { now: () => nowMs });
  const session = cookiePair(await login(gate, env));

  for (const path of [
    "/_vinext/image?url=%2Fphoto.jpg",
    "/_vinext/image/nested/path",
  ]) {
    const response = await gate.fetch(request(path, {
      headers: { cookie: session },
    }), env, context());
    assert.equal(response.status, 404, path);
    assertPrivateResponse(response);
  }
  assert.equal(next.calls.length, 0);
});
