import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://staging.test";
const password = "runtime-test-only-password";
const secret = "runtime-test-only-session-secret-32-bytes";
const clientRoot = path.join(cwd, "dist/client");

async function moduleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await moduleFiles(absolute));
    else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) files.push(absolute);
  }
  return files.sort();
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function expiredCookie() {
  const now = Math.floor(Date.now() / 1_000);
  const payload = base64url(JSON.stringify({
    v: 1,
    host: "staging.test",
    iat: now - (8 * 60 * 60) - 60,
    exp: now - 60,
    nonce: "A".repeat(24),
  }));
  const signingKey = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`staging-gate:session\0${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(payload));
  return `__Host-staging_gate=${payload}.${base64url(new Uint8Array(signature))}`;
}

function tamper(cookie) {
  const [name, value] = cookie.split("=");
  const [payload, signature] = value.split(".");
  const first = signature.startsWith("A") ? "B" : "A";
  return `${name}=${payload}.${first}${signature.slice(1)}`;
}

function assertProtected(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

async function consume(response) {
  return Buffer.from(await response.arrayBuffer());
}

test("STAGE-RUNTIME executes the staging gate, assets, app, and native limiter in Miniflare", async (t) => {
  const sourceModules = [
    path.join(cwd, "staging-entry.mjs"),
    path.join(cwd, "worker/staging-gate.mjs"),
    path.join(cwd, "worker/staging-assets.mjs"),
    ...await moduleFiles(path.join(cwd, "dist/server")),
  ];
  let outboundCalls = 0;
  const options = convertV4MiniflareOptions({
    name: "staging-local",
    modulesRoot: cwd,
    modules: sourceModules.map((absolute) => ({ type: "ESModule", path: absolute })),
    compatibilityDate: "2026-09-07",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      APP_ENV: "staging",
      STAGING_ACCESS_PASSWORD: password,
      STAGING_SESSION_SECRET: secret,
    },
    ratelimits: {
      STAGING_LOGIN_LIMITER: {
        namespace_id: "20260929",
        simple: { limit: 5, period: 60 },
      },
    },
    assets: {
      directory: clientRoot,
      binding: "ASSETS",
      run_worker_first: true,
      routerConfig: { has_user_worker: true },
    },
    outboundService: () => {
      outboundCalls += 1;
      return new Response("Blocked outbound request", { status: 503 });
    },
  });
  const miniflare = new Miniflare(options);
  const dispatch = (pathname, init = {}) => miniflare.dispatchFetch(`${origin}${pathname}`, {
    ...init,
    redirect: "manual",
  });
  let session;

  try {
    await t.test("unauthenticated requests are gated and login issues the runtime cookie", async () => {
      const browser = await dispatch("/", { headers: { accept: "text/html" } });
      assert.equal(browser.status, 303);
      assert.equal(browser.headers.get("location"), "/__staging/login");
      assertProtected(browser);
      await consume(browser);

      const api = await dispatch("/api/version");
      assert.equal(api.status, 401);
      assertProtected(api);
      await consume(api);

      const login = await dispatch("/__staging/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "cf-connecting-ip": "203.0.113.10",
          origin,
        },
        body: new URLSearchParams({ password }),
      });
      assert.equal(login.status, 303);
      assert.equal(login.headers.get("location"), "/");
      assertProtected(login);
      session = login.headers.get("set-cookie")?.split(";", 1)[0];
      assert.match(session ?? "", /^__Host-staging_gate=.+/);
      await consume(login);
      assert.equal(outboundCalls, 0);
    });
    assert.ok(session, "runtime login must produce a session for authenticated checks");

    await t.test("compiled JavaScript and CSS require auth and preserve bytes and MIME on GET and HEAD", async () => {
      const assetNames = (await readdir(path.join(clientRoot, "assets"))).sort();
      const fixtures = [
        [assetNames.find((name) => name.endsWith(".js")), /^(?:text|application)\/javascript\b/i],
        [assetNames.find((name) => name.endsWith(".css")), /^text\/css\b/i],
      ];
      for (const [name, mime] of fixtures) {
        assert.ok(name, "build must contain both JavaScript and CSS assets");
        const pathname = `/assets/${name}`;
        const expected = await readFile(path.join(clientRoot, "assets", name));

        for (const method of ["GET", "HEAD"]) {
          const denied = await dispatch(pathname, { method, headers: { accept: "text/html" } });
          assert.equal(denied.status, 401, `${method} ${pathname} without cookie`);
          assertProtected(denied);
          await consume(denied);
        }

        const get = await dispatch(pathname, { headers: { cookie: session } });
        assert.equal(get.status, 200, pathname);
        assert.match(get.headers.get("content-type") ?? "", mime, pathname);
        assertProtected(get);
        assert.deepEqual(await consume(get), expected, pathname);

        const head = await dispatch(pathname, { method: "HEAD", headers: { cookie: session } });
        assert.equal(head.status, 200, `HEAD ${pathname}`);
        assert.match(head.headers.get("content-type") ?? "", mime, pathname);
        assertProtected(head);
        assert.equal((await consume(head)).length, 0, pathname);
      }
    });

    await t.test("compiled public favicon and guide PDF keep their existing static routing", async () => {
      for (const [pathname, relative, mime] of [
        ["/favicon.svg", "favicon.svg", /^image\/svg\+xml\b/i],
        ["/guides/bookstore-news-input-guide.pdf", "guides/bookstore-news-input-guide.pdf", /^application\/pdf\b/i],
      ]) {
        const expected = await readFile(path.join(clientRoot, relative));
        const get = await dispatch(pathname, { headers: { cookie: session } });
        assert.equal(get.status, 200, pathname);
        assert.match(get.headers.get("content-type") ?? "", mime, pathname);
        assertProtected(get);
        assert.deepEqual(await consume(get), expected, pathname);

        const head = await dispatch(pathname, { method: "HEAD", headers: { cookie: session } });
        assert.equal(head.status, 200, `HEAD ${pathname}`);
        assert.match(head.headers.get("content-type") ?? "", mime, pathname);
        assertProtected(head);
        assert.equal((await consume(head)).length, 0, pathname);
      }
    });

    await t.test("authenticated asset POST remains application-owned", async () => {
      const name = (await readdir(path.join(clientRoot, "assets"))).sort().find((entry) => entry.endsWith(".js"));
      assert.ok(name);
      const expected = await readFile(path.join(clientRoot, "assets", name));
      const response = await dispatch(`/assets/${name}`, {
        method: "POST",
        headers: { cookie: session, "content-type": "text/plain" },
        body: "not an asset read",
      });
      assert.notEqual(response.status, 200);
      assertProtected(response);
      assert.notDeepEqual(await consume(response), expected);
    });

    await t.test("authenticated API reaches the app but never a Supabase or outbound target", async () => {
      const response = await dispatch("/api/version", { headers: { cookie: session } });
      assert.equal(response.status, 503);
      assertProtected(response);
      const body = JSON.parse((await consume(response)).toString("utf8"));
      assert.deepEqual(body, { error: "버전 확인에 필요한 저장소 연결 정보가 없습니다." });
      assert.equal(outboundCalls, 0);
    });

    await t.test("tampered and correctly signed expired cookies are rejected by the runtime", async () => {
      for (const cookie of [tamper(session), await expiredCookie()]) {
        const response = await dispatch("/api/version", { headers: { cookie } });
        assert.equal(response.status, 401);
        assertProtected(response);
        await consume(response);
      }
    });

    await t.test("logout clears the runtime cookie", async () => {
      const response = await dispatch("/__staging/logout", {
        method: "POST",
        headers: {
          cookie: session,
          "content-type": "application/x-www-form-urlencoded",
          origin,
        },
        body: "",
      });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/__staging/login");
      assert.match(response.headers.get("set-cookie") ?? "", /^__Host-staging_gate=;.*\bMax-Age=0\b/i);
      assertProtected(response);
      await consume(response);
    });

    await t.test("native Miniflare rate limit allows five attempts and rejects the sixth", async () => {
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const response = await dispatch("/__staging/login", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "cf-connecting-ip": "198.51.100.20",
            origin,
          },
          body: new URLSearchParams({ password: "wrong-runtime-password" }),
        });
        assert.equal(response.status, attempt <= 5 ? 401 : 429, `attempt ${attempt}`);
        if (attempt === 6) assert.equal(response.headers.get("retry-after"), "60");
        assertProtected(response);
        await consume(response);
      }
    });

    assert.equal(outboundCalls, 0, "no runtime scenario may leave Miniflare");
  } finally {
    await miniflare.dispose();
  }
});
