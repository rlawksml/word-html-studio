// Real Chromium native forms; entirely in-memory HTTP fixture, no server/envfile/DB.
// PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright/index.mjs npm run test:staging-browser
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createStagingGate } from "../worker/staging-gate.mjs";

const SITE = "https://staging.fixture.invalid";
const ATTACKER = "https://attacker.fixture.invalid";
const LOGIN = "/__staging/login";
const LOGOUT = "/__staging/logout";
const COOKIE = "__Host-staging_gate";
const PASSWORD = "synthetic-only-password-not-a-real-secret";
const SECRET = "synthetic-only-signing-secret-never-used-remotely";
let step = "initialization";
const originClass = (value) => value === SITE ? "same-origin" : value === ATTACKER ? "cross-origin"
  : value === "null" ? "null" : value === null ? "missing" : "unexpected";

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
  const browser = await chromium.launch({ headless: true });
  let context;
  const results = [];
  const network = { methods: {}, statuses: {}, originClasses: {}, externalAttempts: 0, failures: 0, handlerTimingMs: {} };
  const consoleCounts = {};
  const expectedHttpConsoleCounts = {};
  let unexpectedConsoleErrors = 0, pageErrors = 0, routeErrors = 0;
  let upstreamCalls = 0, limiterCalls = 0;
  let limiterMode = "allow", legacyPolicy = false, attackerTarget = LOGIN;
  const transactions = [];
  const pass = (name) => { results.push(name); console.log(`PASS ${name}`); };
  const env = {
    APP_ENV: "staging", STAGING_ACCESS_PASSWORD: PASSWORD, STAGING_SESSION_SECRET: SECRET,
    STAGING_LOGIN_LIMITER: {
      async limit() {
        limiterCalls++;
        if (limiterMode === "unavailable") throw new Error("synthetic limiter unavailable");
        return { success: limiterMode !== "deny" };
      },
    },
  };
  const gate = createStagingGate({
    async fetch(request) {
      upstreamCalls++;
      assert.ok(!(request.headers.get("cookie") || "").includes(`${COOKIE}=`), "gate cookie must not reach upstream");
      return new Response('<!doctype html><title>Fixture workspace</title><h1>Fixture workspace</h1><a href="/__staging/logout">Leave fixture</a>', {
        headers: {
          "content-type": "text/html; charset=utf-8", "referrer-policy": "unsafe-url",
          "set-cookie": "fixture_upstream=synthetic-only; Path=/; Secure; HttpOnly; SameSite=Strict",
        },
      });
    },
  });
  try {
    context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    // Install before creating pages. Never continue/fetch any request: even
    // allowed fixture URLs are fulfilled in memory. All other origins abort.
    const handleRoute = async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== SITE && url.origin !== ATTACKER) {
        network.externalAttempts++;
        await route.abort("blockedbyclient");
        return;
      }
      try {
        if (url.origin === ATTACKER) {
          assert.ok(request.method() === "GET" && url.pathname === "/attack", "only explicit attacker fixture permitted");
          const input = attackerTarget === LOGIN ? `<input type="hidden" name="password" value="${PASSWORD}">` : "";
          await route.fulfill({ status: 200,
            headers: { "content-type": "text/html", "referrer-policy": "unsafe-url", "cache-control": "no-store" },
            body: `<!doctype html><title>Attacker fixture</title><form method="post" action="${SITE}${attackerTarget}">${input}<button>Submit fixture</button></form>`,
          });
          return;
        }
        // Preserve Chromium's native Origin/Cookie exactly. Only the dummy
        // Cloudflare client-IP header is injected; no Origin/Referer override.
        const headers = new Headers(await request.allHeaders());
        const nativeOrigin = headers.get("origin");
        headers.set("cf-connecting-ip", "203.0.113.42");
        const method = request.method();
        const started = performance.now();
        const bridged = new Request(request.url(), { method, headers,
          ...(method === "GET" || method === "HEAD" ? {} : { body: request.postDataBuffer() }),
        });
        assert.ok(bridged.headers.get("origin") === nativeOrigin, "native Origin must survive bridge unchanged");
        const response = await gate.fetch(bridged, env, { waitUntil() {}, passThroughOnException() {} });
        const duration = Math.round((performance.now() - started) * 1000) / 1000;
        const timingKey = `${method}:${response.status}`;
        const timing = network.handlerTimingMs[timingKey] ?? { count: 0, min: duration, max: duration };
        timing.count++;
        timing.min = Math.min(timing.min, duration);
        timing.max = Math.max(timing.max, duration);
        network.handlerTimingMs[timingKey] = timing;
        // Baseline changes served document policy, never browser request headers.
        if (legacyPolicy && method === "GET" && [LOGIN, LOGOUT].includes(url.pathname)) {
          response.headers.set("referrer-policy", "no-referrer");
        }
        const path = url.pathname === LOGIN ? "login" : url.pathname === LOGOUT ? "logout" : "protected";
        const origin = originClass(nativeOrigin);
        network.methods[method] = (network.methods[method] || 0) + 1;
        network.statuses[response.status] = (network.statuses[response.status] || 0) + 1;
        network.originClasses[origin] = (network.originClasses[origin] || 0) + 1;
        transactions.push({ method, path, status: response.status, origin,
          expiresGateSession: response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${COOKIE}=`) && /;\s*Max-Age=0\b/.test(cookie)) });
        const fulfillHeaders = Object.fromEntries(response.headers);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) fulfillHeaders["set-cookie"] = cookies.join("\n");
        await route.fulfill({ status: response.status, headers: fulfillHeaders, body: Buffer.from(await response.arrayBuffer()) });
      } catch {
        routeErrors++;
        // No raw exception, URL, headers, credentials, cookie or request dump.
        await route.fulfill({ status: 500, body: "Synthetic fixture handler failed" });
      }
    };
    const page = await context.newPage();
    // Raw CDP intercepts every redirect hop. Playwright context.route skips
    // subsequent redirected requests, which would otherwise resolve .invalid.
    const transport = await context.newCDPSession(page);
    transport.on("Fetch.requestPaused", (event) => {
      const request = event.request;
      const route = {
        request: () => ({
          url: () => request.url,
          method: () => request.method,
          allHeaders: async () => request.headers,
          postDataBuffer: () => Buffer.from(request.postData || ""),
        }),
        abort: async () => transport.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }),
        fulfill: async ({ status, headers = {}, body = "" }) => transport.send("Fetch.fulfillRequest", {
          requestId: event.requestId, responseCode: status,
          responseHeaders: Object.entries(headers).flatMap(([name, value]) =>
            name.toLowerCase() === "set-cookie" ? value.split("\n").map((item) => ({ name, value: item })) : [{ name, value: String(value) }]),
          body: Buffer.from(body).toString("base64"),
        }),
      };
      handleRoute(route).catch(() => { routeErrors++; });
    });
    await transport.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    page.setDefaultTimeout(15_000);
    page.on("console", (message) => {
      consoleCounts[message.type()] = (consoleCounts[message.type()] || 0) + 1;
      if (message.type() !== "error") return;
      // Classify known Chromium HTTP diagnostics without retaining message text.
      const match = /^Failed to load resource: the server responded with a status of (401|403|429|503)\b/.exec(message.text());
      const status = match ? Number(match[1]) : 0;
      if (status && transactions.some((entry) => entry.status === status)) {
        expectedHttpConsoleCounts[status] = (expectedHttpConsoleCounts[status] || 0) + 1;
      } else unexpectedConsoleErrors++;
    });
    page.on("pageerror", () => { pageErrors++; });
    page.on("requestfailed", () => { network.failures++; });
    const hasSession = async () => (await context.cookies(SITE)).some((cookie) => cookie.name === COOKIE);
    const getForm = async (path) => {
      const response = await page.goto(`${SITE}${path}`);
      assert.ok(response?.status() === 200, "native form GET must succeed");
      assert.ok(response.headers()["referrer-policy"] === (legacyPolicy ? "no-referrer" : "same-origin"), "served form policy must match scenario");
      await page.locator("form button").waitFor({ state: "visible" });
      assert.ok(await page.locator("form button").isEnabled(), "form must be usable");
    };
    const submit = async (path, expectedStatus, expectedOrigin) => {
      const before = transactions.filter((entry) => entry.method === "POST").length;
      const observed = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === path);
      await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator("form button").click()]);
      const response = await observed;
      assert.ok(response.status() === expectedStatus, "native POST must have expected status");
      assert.ok(response.headers()["referrer-policy"] === "no-referrer", "POST response policy stays restrictive");
      const posts = transactions.filter((entry) => entry.method === "POST");
      assert.ok(posts.length === before + 1, "one click must produce exactly one native POST");
      assert.ok(posts.at(-1).origin === expectedOrigin, "browser-generated Origin class must match");
      return response;
    };
    const login = async () => {
      await getForm(LOGIN);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await submit(LOGIN, 303, "same-origin");
      assert.ok(new URL(page.url()).pathname === "/", "login redirects to fixture workspace");
      await page.getByRole("heading", { name: "Fixture workspace" }).waitFor();
      const cookies = await context.cookies(SITE);
      const session = cookies.find((cookie) => cookie.name === COOKIE);
      assert.ok(!!session && session.httpOnly && session.secure && session.sameSite === "Strict", "browser stores secure synthetic session");
      assert.ok(cookies.some((cookie) => cookie.name === "fixture_upstream"), "synthetic upstream Set-Cookie survives forwarding");
    };
    const logout = async () => {
      await getForm(LOGOUT);
      await submit(LOGOUT, 303, "same-origin");
      // Chromium consumes Set-Cookie but omits it from synthetic response
      // inspection. Assert both outgoing expiry instruction and browser effect.
      assert.ok(transactions.findLast((entry) => entry.method === "POST" && entry.path === "logout")?.expiresGateSession, "logout emits gate cookie expiry");
      assert.ok(new URL(page.url()).pathname === LOGIN, "logout redirects to login");
      assert.ok(!await hasSession(), "browser removes gate cookie");
      assert.ok(await page.locator("form button").isEnabled(), "redirected form is usable");
    };

    step = "legacy null-origin baseline";
    legacyPolicy = true;
    await getForm(LOGIN);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await submit(LOGIN, 403, "null");
    assert.ok(!await hasSession() && limiterCalls === 0 && upstreamCalls === 0, "legacy null Origin rejected before limiter/upstream");
    legacyPolicy = false;
    pass("STAGE-NATIVE-01 legacy no-referrer produces actual null Origin and 403");

    step = "current successful login/logout";
    await login();
    await logout();
    const denied = await page.goto(`${SITE}/`);
    assert.ok(denied?.status() === 200 && new URL(page.url()).pathname === LOGIN, "protected navigation after logout redirects to form");
    pass("STAGE-NATIVE-02 same-origin native login/logout 303 and cookie lifecycle");

    step = "wrong password and recovery";
    await getForm(LOGIN);
    await page.locator('input[name="password"]').fill("synthetic-wrong-password");
    await submit(LOGIN, 401, "same-origin");
    assert.ok(!await hasSession(), "wrong password cannot create session");
    await page.goBack({ waitUntil: "load" });
    await page.locator("form button").waitFor({ state: "visible" });
    assert.ok(await page.locator("form button").isEnabled(), "pageshow restores submit on back navigation");
    await page.locator('input[name="password"]').fill(PASSWORD);
    await submit(LOGIN, 303, "same-origin");
    assert.ok(await hasSession(), "correct retry recovers session");
    await logout();
    pass("STAGE-NATIVE-03 wrong-password 401 and back-navigation retry recovery");

    step = "cross-origin rejection";
    for (const path of [LOGIN, LOGOUT]) {
      attackerTarget = path;
      const beforeLimiter = limiterCalls, beforeUpstream = upstreamCalls;
      await page.goto(`${ATTACKER}/attack`);
      await submit(path, 403, "cross-origin");
      assert.ok(!await hasSession(), "cross-origin form cannot create session");
      assert.ok(limiterCalls === beforeLimiter && upstreamCalls === beforeUpstream, "cross-origin rejected before limiter/upstream");
    }
    pass("STAGE-NATIVE-04 cross-origin native login/logout rejected");

    step = "null-origin logout rejection";
    await login();
    legacyPolicy = true;
    await getForm(LOGOUT);
    await submit(LOGOUT, 403, "null");
    assert.ok(await hasSession(), "null-origin logout cannot clear valid session");
    legacyPolicy = false;
    await logout();
    pass("STAGE-NATIVE-05 null-origin logout rejected without clearing session");

    for (const [mode, status] of [["deny", 429], ["unavailable", 503]]) {
      step = `limiter ${status} and recovery`;
      limiterMode = mode;
      const beforeUpstream = upstreamCalls;
      await getForm(LOGIN);
      await page.locator('input[name="password"]').fill(PASSWORD);
      const response = await submit(LOGIN, status, "same-origin");
      assert.ok(!await hasSession() && upstreamCalls === beforeUpstream, "limiter failure cannot admit user");
      if (status === 429) assert.ok(response.headers()["retry-after"] === "60", "rate limit gives retry guidance");
      limiterMode = "allow";
      await login();
      await logout();
      pass(`STAGE-NATIVE-06 limiter ${status} fails closed then recovers`);
    }

    step = "ten-cycle resource trend";
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const samples = [];
    try {
      for (let cycle = 1; cycle <= 10; cycle++) {
        await login();
        await logout();
        if (cycle % 2 === 0) {
          // Equal cleanup excludes intentional history retention from trend.
          await cdp.send("Page.resetNavigationHistory");
          await cdp.send("HeapProfiler.collectGarbage");
          const { metrics } = await cdp.send("Performance.getMetrics");
          const selected = Object.fromEntries(metrics.filter(({ name }) =>
            ["JSHeapUsedSize", "Nodes", "JSEventListeners", "Documents"].includes(name)).map(({ name, value }) => [name, value]));
          assert.ok(Object.keys(selected).length === 4, "all resource channels must be measured");
          samples.push({ cycle, ...selected });
        }
      }
    } finally { await cdp.detach(); }
    const baseline = samples[0];
    for (const sample of samples.slice(1)) {
      assert.ok(sample.JSHeapUsedSize <= baseline.JSHeapUsedSize * 1.5 + 4 * 1024 * 1024, "post-GC heap stays bounded");
      assert.ok(sample.Nodes <= baseline.Nodes + 200, "post-GC DOM stays bounded");
      assert.ok(sample.JSEventListeners <= baseline.JSEventListeners + 40, "post-GC listeners stay bounded");
      assert.ok(sample.Documents <= baseline.Documents + 8, "post-GC documents stay bounded");
    }
    assert.ok(!await hasSession(), "repeated cycles end logged out");
    assert.ok(network.externalAttempts === 0 && network.failures === 0, "no external or failed transport requests");
    assert.ok(routeErrors === 0 && pageErrors === 0 && unexpectedConsoleErrors === 0, "no handler/JS/unexpected console errors");
    for (const [status, count] of Object.entries(expectedHttpConsoleCounts)) {
      assert.ok(count <= network.statuses[status], "HTTP console diagnostics cannot exceed matched responses");
    }
    pass("STAGE-NATIVE-07 ten login/logout cycles with five bounded post-GC samples");
    console.log(JSON.stringify({ results, network, consoleCounts, expectedHttpConsoleCounts,
      unexpectedConsoleErrors, pageErrors, routeErrors, limiterCalls, upstreamCalls, samples,
      resourceScope: "Short synthetic trend after history reset/GC, not proof of no real-world memory leaks",
      dataSafety: "All HTTP(S) intercepted; synthetic secrets/cookies only; no server/envfile/DB/Storage/remote fetch",
    }, null, 2));
  } finally {
    try { if (context) await context.close(); } finally { await browser.close(); }
  }
}
try { await run(); } catch (error) {
  const reason = String(error?.message ?? "unknown").split("\n", 1)[0].replaceAll(PASSWORD, "[fixture]").replaceAll(SECRET, "[fixture]");
  console.error(`FAIL staging-native-form at ${step}: ${reason}; request headers/cookies omitted`);
  process.exitCode = 1;
}
