import assert from "node:assert/strict";
import test from "node:test";
import { createStagingAssetAdapter } from "../worker/staging-assets.mjs";
import { createStagingGate } from "../worker/staging-gate.mjs";

function fixture(assetFetch) {
  const calls = [];
  const appResponse = new Response("application", { status: 299 });
  const application = { fetch(...args) { calls.push(args); return appResponse; } };
  const env = { ASSETS: { fetch: assetFetch } };
  const ctx = {};
  return { adapter: createStagingAssetAdapter(application), calls, appResponse, env, ctx };
}

test("asset GET and HEAD preserve request, binding receiver, response and headers", async () => {
  for (const method of ["GET", "HEAD"]) {
    const request = new Request("https://stage.example/assets/app.js?v=1", {
      method, headers: { range: "bytes=0-9", "if-none-match": '"asset-v1"' },
    });
    const response = new Response(method === "HEAD" ? null : "javascript", {
      status: 206, headers: { "content-type": "text/javascript", etag: '"asset-v1"' },
    });
    const f = fixture(function (received) {
      assert.equal(this, f.env.ASSETS);
      assert.equal(received, request);
      return response;
    });
    assert.equal(await f.adapter.fetch(request, f.env, f.ctx), response);
    assert.equal(f.calls.length, 0);
  }
});

test("only exact 404 falls back and releases its body first", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 404 });
  const f = fixture(() => response);
  const request = new Request("https://stage.example/assets/missing.js");
  assert.equal(await f.adapter.fetch(request, f.env, f.ctx), f.appResponse);
  assert.equal(cancelled, true);
  assert.deepEqual(f.calls, [[request, f.env, f.ctx]]);
});

test("asset responses other than 404 never fall back, including redirects and failures", async () => {
  for (const status of [200, 206, 301, 302, 304, 401, 403, 429, 500, 503]) {
    const response = new Response(null, { status, headers: { "x-asset": "kept" } });
    const f = fixture(() => response);
    assert.equal(await f.adapter.fetch(new Request("https://stage.example/assets/app.css"), f.env, f.ctx), response);
    assert.equal(f.calls.length, 0);
  }
});

test("other paths and unsafe methods remain application-owned", async () => {
  for (const [path, method] of [
    ["/", "GET"], ["/api/workspace", "GET"], ["/assets", "GET"],
    ["/assets-other/app.js", "GET"], ["/ASSETS/app.js", "GET"],
    ["/favicon.ico", "GET"], ["/_vinext/image", "GET"],
    ["/assets/app.js", "POST"], ["/assets/app.js", "PUT"],
    ["/assets/app.js", "DELETE"], ["/assets/app.js", "OPTIONS"],
  ]) {
    const f = fixture(() => { throw new Error("assets must not run"); });
    const request = new Request(`https://stage.example${path}`, { method });
    assert.equal(await f.adapter.fetch(request, f.env, f.ctx), f.appResponse);
    assert.deepEqual(f.calls, [[request, f.env, f.ctx]]);
  }
});

test("missing or failing binding returns generic 503 without app fallback or leaked details", async () => {
  for (const assets of [undefined, {}, { fetch() { throw new Error("private-storage-secret"); } }]) {
    const f = fixture();
    f.env.ASSETS = assets;
    const response = await f.adapter.fetch(new Request("https://stage.example/assets/app.js"), f.env, f.ctx);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "정적 파일을 불러올 수 없습니다.");
    assert.equal(f.calls.length, 0);
  }
});

test("outer gate denies unauthenticated assets without reaching binding or app", async () => {
  let assetCalls = 0;
  const f = fixture(() => { assetCalls += 1; return new Response("private asset"); });
  Object.assign(f.env, {
    APP_ENV: "staging",
    STAGING_ACCESS_PASSWORD: "unit-test-only-password",
    STAGING_SESSION_SECRET: "unit-test-only-secret-at-least-32-bytes",
  });
  const gate = createStagingGate(f.adapter);
  const response = await gate.fetch(new Request("https://stage.example/assets/app.js"), f.env, f.ctx);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(assetCalls, 0);
  assert.equal(f.calls.length, 0);
});

test("authenticated composition strips only the gate cookie before serving an asset", async () => {
  let assetCalls = 0;
  const f = fixture((request) => {
    assetCalls += 1;
    assert.equal(request.headers.get("cookie"), "theme=dark");
    return new Response("private asset", {
      headers: { "content-type": "text/javascript" },
    });
  });
  Object.assign(f.env, {
    APP_ENV: "staging",
    STAGING_ACCESS_PASSWORD: "unit-test-only-password",
    STAGING_SESSION_SECRET: "unit-test-only-secret-at-least-32-bytes",
    STAGING_LOGIN_LIMITER: { limit: async () => ({ success: true }) },
  });
  const gate = createStagingGate(f.adapter);
  const login = await gate.fetch(new Request("https://stage.example/__staging/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "203.0.113.10",
      origin: "https://stage.example",
    },
    body: new URLSearchParams({ password: f.env.STAGING_ACCESS_PASSWORD }),
  }), f.env, f.ctx);
  assert.equal(login.status, 303);
  const session = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(session);
  await login.arrayBuffer();

  const response = await gate.fetch(new Request("https://stage.example/assets/app.js", {
    headers: { cookie: `${session}; theme=dark` },
  }), f.env, f.ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "private asset");
  assert.equal(assetCalls, 1);
  assert.equal(f.calls.length, 0);
});
