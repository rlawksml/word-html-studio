// Run from apps/web. Uses existing build and Playwright; never starts a server.
// All data, sessions and Clipboard API values below are synthetic, not production.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { installFixtureResponseObserver } from "./helpers/fixture-response-observer.mjs";

const WEB = resolve(process.cwd());
const SITE = "https://html-copy.fixture.invalid";
const SYNTHETIC_PASSWORD = "synthetic-html-fixture-only";
let step = "initialization";

// Strip all inherited application secrets before loading the built SSR module.
// Explicit env -i subprocess; no env files, NODE_OPTIONS or inherited auth vars.
if (!process.argv.includes("--isolated-child")) {
  const selected = ["PLAYWRIGHT_MODULE_PATH", "PLAYWRIGHT_BROWSERS_PATH"]
    .filter((name) => process.env[name]).map((name) => `${name}=${process.env[name]}`);
  const child = spawn("/usr/bin/env", ["-i", "PATH=/usr/bin:/bin", ...selected,
    process.execPath, fileURLToPath(import.meta.url), "--isolated-child"], { cwd: WEB, stdio: "inherit" });
  child.on("error", () => { console.error("FAIL isolated fixture subprocess could not start"); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} else {
  try { await run(); } catch (error) {
    const reason = error?.code === "ERR_ASSERTION" ? String(error.message).split("\n", 1)[0] : `fixture environment/automation failure (${String(error?.name || "unknown")})`;
    console.error(`FAIL browser-html-copy at ${step}: ${reason}`);
    process.exitCode = 1;
  }
}

async function run() {
  let nodeNetworkAttempts = 0;
  const denyNodeNetwork = () => { nodeNetworkAttempts++; throw new Error("Node network disabled in synthetic fixture"); };
  globalThis.fetch = async () => denyNodeNetwork();
  http.request = http.get = https.request = https.get = denyNodeNetwork;
  net.connect = net.createConnection = tls.connect = denyNodeNetwork;
  syncBuiltinESMExports();
  step = "import installed Playwright";
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
  const playwrightRequire = createRequire(process.env.PLAYWRIGHT_MODULE_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH) : import.meta.url);
  const playwrightVersion = playwrightRequire(process.env.PLAYWRIGHT_MODULE_PATH ? "./package.json" : "playwright/package.json").version;
  step = "import built SSR worker";
  const { default: worker } = await import(pathToFileURL(resolve(WEB, "dist/server/index.js")).href);
  step = "import installed JSZip and bounded assets";
  const JSZip = createRequire(pathToFileURL(resolve(WEB, "package.json")))("jszip");
  const clientRoot = await realpath(resolve(WEB, "dist/client"));
  const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
  const stamp = "2026-11-04T00:00:00.000Z";
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const descriptions = ["LF 첫줄\n둘째", "CRLF 첫줄\r\n둘째", "CR 첫줄\r둘째", "빈줄 첫줄\n\n마지막", '이모지 📚 <script>literal</script> & > "\r\n둘째\r셋째\n\n끝'];
  const workspace = {
    bookstores: [{ id: 91001, updatedAt: stamp, sortOrder: 0, name: "합성 검증 책방", region: "가상 지역", address: "", hours: "", phone: "", sns: "", website: "", introduction: "", contacts: [], links: [] }],
    submissions: [{ id: 91002, bookstoreId: 91001, month, status: "completed", updatedAt: stamp, completedAt: stamp, publishedAt: "", publishedUrl: "", monthlyNotice: "", news: descriptions.map((description, index) => ({
      id: 91100 + index, title: `합성 소식 ${index + 1}`, description, dates: [], scheduleRange: null, scheduleText: "", regular: false, displayLabel: "", deadline: "", place: "", fee: "", applicationInfo: "", applyUrl: "", extraFields: [], links: [], includeInDigest: true, images: [],
    })) }],
  };
  const sourceBefore = JSON.stringify(workspace);
  let activeSession = false, clipboardWrites = 0;
  let externalAttempts = 0, handlerErrors = 0, consoleErrors = 0, pageErrors = 0, transportFailures = 0;
  const api = [];
  const requestKinds = {};
  const handlerErrorKinds = {};
  const transportFailureKinds = {};
  const apiRequests = [];
  const apiPathnames = ["/api/session", "/api/workspace", "/api/presence"];
  let diagnosticPage;
  const results = [];
  const pass = (name) => { results.push(name); console.log(`PASS ${name}`); };
  step = "launch ephemeral headless Chromium";
  const browser = await chromium.launch({ headless: true });
  const runtime = { playwright: playwrightVersion, chromium: browser.version() };
  const contexts = [];
  const sessions = [];
  const downloads = [];

  async function preparePage(context, renderHtml = null) {
    const page = await context.newPage();
    const requests = new Map(), occurrences = new Map();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== SITE || !apiPathnames.includes(url.pathname) || !["GET", "POST", "DELETE"].includes(request.method())) return;
      const key = `${request.method()} ${url.pathname}`;
      const occurrence = (occurrences.get(key) || 0) + 1;
      occurrences.set(key, occurrence);
      const record = { key: `${key} #${occurrence}`, pathname: url.pathname, method: request.method(),
        state: "pending", startedMs: Math.round(performance.now()) };
      requests.set(request, record);
      apiRequests.push(record);
    });
    page.on("response", (response) => {
      const record = requests.get(response.request());
      if (record) Object.assign(record, { status: response.status(), responseMs: Math.round(performance.now()) });
    });
    const complete = (request, state) => {
      const record = requests.get(request);
      if (record) Object.assign(record, { state, completedMs: Math.round(performance.now()),
        timingMs: Math.round(performance.now()) - record.startedMs });
    };
    page.on("requestfinished", (request) => complete(request, "finished"));
    page.setDefaultTimeout(15_000);
    page.on("console", (message) => { if (message.type() === "error") consoleErrors++; });
    page.on("pageerror", () => { pageErrors++; });
    page.on("requestfailed", (request) => {
      complete(request, "failed");
      const record = requests.get(request), errorText = request.failure()?.errorText;
      if (record) record.failure = /^net::ERR_[A-Z_]+$/.test(errorText || "") ? errorText : "other";
      transportFailures++;
      const pathname = new URL(request.url()).pathname;
      const type = ["/help.rsc", "/improvements.rsc"].includes(pathname) ? "known-prefetch"
        : ["/api/session", "/api/workspace", "/api/presence"].includes(pathname) ? `mock-${pathname.split("/").at(-1)}-${request.method()}` : request.resourceType();
      const code = request.failure()?.errorText;
      const kind = `${type}:${/^net::ERR_[A-Z_]+$/.test(code || "") ? code : "other"}`;
      transportFailureKinds[kind] = (transportFailureKinds[kind] || 0) + 1;
    });
    const cdp = await context.newCDPSession(page);
    sessions.push(cdp);
    cdp.on("Fetch.requestPaused", (event) => {
      void handle(event).catch(() => { handlerErrors++; });
    });
    async function handle(event) {
      const { request, requestId } = event;
      const started = performance.now();
      const fulfill = async (status, contentType, body = "") => cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: status,
        responseHeaders: [{ name: "Cache-Control", value: "no-store" }, ...(status === 204
          ? [{ name: "Content-Length", value: "0" }] : [{ name: "Content-Type", value: contentType }])],
        ...(status === 204 ? {} : { body: Buffer.from(body).toString("base64") }),
      });
      let requestKind = "unknown";
      try {
        const url = new URL(request.url);
        requestKind = renderHtml !== null ? "render" : url.pathname.startsWith("/api/") ? "api" : url.pathname === "/" ? "ssr" : "asset";
        requestKinds[requestKind] = (requestKinds[requestKind] || 0) + 1;
        if (url.origin !== SITE) {
          externalAttempts++;
          await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
          return;
        }
        if (renderHtml !== null) {
          assert.ok(request.method === "GET" && url.pathname === "/__fixture/render", "isolated document must request only its fixture URL");
          return fulfill(200, "text/html; charset=utf-8", renderHtml);
        }
        if (url.pathname.startsWith("/api/")) {
          let status = 200, payload;
          if (url.pathname === "/api/workspace" && request.method === "GET") payload = workspace;
          else if (url.pathname === "/api/session") {
            assert.ok(["GET", "POST", "DELETE"].includes(request.method), "session method must be mocked explicitly");
            if (request.method === "POST") {
              const supplied = JSON.parse(request.postData || "{}");
              assert.ok(supplied.code === SYNTHETIC_PASSWORD && supplied.role === "html", "only synthetic HTML login is accepted");
              activeSession = true;
            } else if (request.method === "DELETE") { activeSession = false; status = 204; }
            else assert.ok(activeSession, "restored session must already be synthetic");
            payload = { role: "html" };
          } else if (url.pathname === "/api/presence") {
            assert.ok(activeSession && ["POST", "DELETE"].includes(request.method), "presence must use active mock session");
            status = request.method === "DELETE" ? 204 : 200;
            payload = { owned: true, activeRole: "html", expiresAt: "2099-01-01T00:00:00.000Z" };
          } else throw new Error("Unmocked API");
          api.push({ method: request.method, status, timingMs: Math.round((performance.now() - started) * 1000) / 1000 });
          return fulfill(status, "application/json", status === 204 ? "" : JSON.stringify(payload));
        }
        if (url.pathname === "/" && request.method === "GET") {
          const response = await worker.fetch(new Request(SITE, { headers: { accept: "text/html" } }),
            { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
          assert.ok(response.status === 200, "built SSR root must render successfully");
          return fulfill(200, "text/html; charset=utf-8", Buffer.from(await response.arrayBuffer()));
        }
        // Header Links prefetch these two routes on viewport visibility. They
        // are inert synthetic cache entries, not real secondary-route SSR.
        // This TC never navigates there and does not validate those pages.
        if (request.method === "GET" && ["/help.rsc", "/improvements.rsc"].includes(url.pathname)) {
          return fulfill(200, "text/x-component", "0:null\n");
        }
        assert.ok(request.method === "GET" && !!mime[extname(url.pathname)], `only bounded built client assets are allowed (${request.method},${extname(url.pathname) || "no-extension"})`);
        const candidate = resolve(clientRoot, `.${decodeURIComponent(url.pathname)}`);
        assert.ok(candidate.startsWith(`${clientRoot}${sep}`), "asset path must stay within built client root");
        const canonical = await realpath(candidate);
        assert.ok(canonical.startsWith(`${clientRoot}${sep}`), "asset realpath must stay within client root");
        const info = await stat(canonical);
        assert.ok(info.isFile() && info.size <= 15 * 1024 * 1024, "asset must be a bounded regular file");
        return fulfill(200, mime[extname(canonical)], await readFile(canonical));
      } catch (error) {
        handlerErrors++;
        const kind = `${requestKind}:${error?.code === "ERR_ASSERTION" ? String(error.message).split("\n", 1)[0] : error?.code || "unknown"}`;
        handlerErrorKinds[kind] = (handlerErrorKinds[kind] || 0) + 1;
        await fulfill(500, "text/plain", "Synthetic fixture failure");
      }
    }
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    return page;
  }

  async function collectApiDiagnostics() {
    let fetches = [], observerErrors = 0;
    const deadline = performance.now() + 1500;
    // Wait for independent bounded byte observation and raw transport completion.
    do {
      const snapshot = diagnosticPage ? await diagnosticPage.evaluate(() => ({
        fetches: window.__fixtureFetchDiagnostics || [], observerErrors: window.__fixtureResponseObserverErrors || 0,
      })).catch(() => ({ fetches: [], observerErrors: 1 })) : { fetches: [], observerErrors: 0 };
      ({ fetches, observerErrors } = snapshot);
      if (fetches.every((entry) => entry.observerState !== "pending") && apiRequests.every((entry) => entry.state !== "pending")) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    } while (performance.now() < deadline);
    return { observationComplete: fetches.every((entry) => entry.observerState !== "pending") && apiRequests.every((entry) => entry.state !== "pending"),
      observerErrors, fetches, requests: apiRequests.map((entry) => ({ ...entry })) };
  }

  // Snapshot just the generated description paragraphs, not wrapper whitespace.
  const snapshot = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => ({
    html: node.innerHTML, text: node.innerText, breaks: node.querySelectorAll("br").length,
    unsafeElements: node.querySelectorAll("script,img,iframe,style").length,
  })));
  const bodySelector = "section > div > p:first-child";
  const normalized = descriptions.map((text) => text.replace(/\r\n?|\n/g, "\n"));
  const checkBodies = (bodies) => {
    assert.ok(bodies.length === descriptions.length, "all five description paragraphs must exist");
    for (let index = 0; index < bodies.length; index++) {
      assert.ok(bodies[index].text === normalized[index], "rendered innerText must preserve normalized newlines and special characters");
      assert.ok(bodies[index].breaks === normalized[index].split("\n").length - 1, "each normalized newline must be an explicit br");
      assert.ok(bodies[index].unsafeElements === 0, "literal HTML must not become executable elements");
    }
  };
  try {
    step = "built SSR UI and synthetic HTML login";
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    contexts.push(context);
    // This is deliberately NOT the OS clipboard. It is per-context test state,
    // installed only here, before the actual application scripts load.
    await context.addInitScript(installFixtureResponseObserver, { origin: SITE });
    await context.addInitScript(() => {
      let text = "", writes = 0;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (value) => { text = String(value); writes++; },
        readText: async () => text,
      } });
      Object.defineProperty(window, "__fixtureClipboardWrites", { get: () => writes });
    });
    const page = await preparePage(context);
    diagnosticPage = page;
    step = "navigate built SSR UI";
    await page.goto(SITE);
    step = "wait for HTML editor entry button";
    await page.getByRole("button", { name: "HTML 편집", exact: true }).click();
    step = "fill synthetic password";
    await page.locator('input[type="password"]').fill(SYNTHETIC_PASSWORD);
    await page.locator(".access-modal .primary-button").click();
    step = "wait for authenticated HTML workspace";
    await page.getByRole("button", { name: "HTML·TXT·사진 ZIP", exact: true }).waitFor();
    const preview = page.frameLocator('iframe[title="합성 검증 책방 HTML 미리보기"]').locator(bodySelector);
    await preview.first().waitFor();
    const previewBodies = await snapshot(preview);
    checkBodies(previewBodies);
    pass("HTML-COPY-01 built UI synthetic HTML login and five newline preview bodies");

    step = "actual copy button to memory Clipboard API";
    await page.getByRole("button", { name: "HTML 복사", exact: true }).click();
    await page.getByText("HTML 코드를 복사했습니다.", { exact: false }).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    clipboardWrites = await page.evaluate(() => window.__fixtureClipboardWrites);
    assert.ok(clipboardWrites === 1 && copied.length > 0, "actual button must write once to memory Clipboard API");
    const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    for (const description of descriptions) {
      assert.ok(copied.includes(escape(description).replace(/\r\n?|\n/g, "<br>")), "copied raw markup must escape text before inserting br");
    }
    await page.getByRole("button", { name: "HTML 코드", exact: true }).click();
    assert.ok(await page.locator(".html-preview pre").textContent() === copied, "displayed HTML code must equal copied body");
    pass("HTML-COPY-02 actual button writes escaped body to context-memory Clipboard API");

    step = "copied body rendered in a fresh isolated HTML document";
    const renderContext = await browser.newContext({ serviceWorkers: "block" });
    contexts.push(renderContext);
    const pasted = await preparePage(renderContext, `<!doctype html><html><meta charset="utf-8"><body>${copied}</body></html>`);
    await pasted.goto(`${SITE}/__fixture/render`);
    const pastedBodies = await snapshot(pasted.locator(bodySelector));
    checkBodies(pastedBodies);
    assert.ok(JSON.stringify(previewBodies) === JSON.stringify(pastedBodies), "preview and fresh pasted document must have identical description DOM/text");
    assert.ok((await renderContext.cookies()).length === 0, "fresh rendered document must have no session cookies");
    pass("HTML-COPY-03 memory-copied body renders identical br/innerText in isolated document");

    step = "actual ZIP download and HTML/TXT parity";
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "HTML·TXT·사진 ZIP", exact: true }).click();
    const download = await downloadEvent;
    downloads.push(download);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const zip = await JSZip.loadAsync(Buffer.concat(chunks));
    const htmlFiles = Object.values(zip.files).filter((file) => !file.dir && file.name.endsWith(".html"));
    const txtFiles = Object.values(zip.files).filter((file) => !file.dir && file.name.endsWith("_HTML코드_복사용.txt"));
    assert.ok(htmlFiles.length === 1 && txtFiles.length === 1, "download must contain one HTML and one copy TXT");
    const zippedHtml = await htmlFiles[0].async("string"), zippedTxt = await txtFiles[0].async("string");
    assert.ok(zippedTxt === copied, "downloaded TXT must equal copied body byte-for-byte");
    assert.ok(zippedHtml.match(/<body>([\s\S]*)<\/body>/)?.[1] === copied, "downloaded HTML body must equal copied body byte-for-byte");
    assert.ok(!Object.values(zip.files).some((file) => !file.dir && file.name.startsWith("사진/")), "photo-free fixture must contain no image files");
    assert.ok(JSON.stringify(workspace) === sourceBefore, "source fixture must remain byte-for-byte unchanged");
    pass("HTML-COPY-04 actual ZIP HTML/TXT match memory-copied markup; source unchanged");

    step = "mock logout and isolation assertions";
    const previousToasts = await page.locator(".toast").allTextContents();
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("button", { name: "HTML 편집", exact: true }).waitFor();
    // Renderer GC is a deterministic test stressor, not a memory/leak audit.
    await sessions[0].send("HeapProfiler.collectGarbage");
    const apiDiagnostics = await collectApiDiagnostics();
    console.log(JSON.stringify({ runtime, apiDiagnostics }));
    assert.ok(apiDiagnostics.observationComplete && apiDiagnostics.observerErrors === 0, "all mock response observers must complete without errors");
    assert.ok(apiDiagnostics.fetches.length === 6 && apiDiagnostics.fetches.every((entry) => entry.state === "resolved"
      && entry.observerState === "completed" && entry.ok && entry.status === (entry.method === "DELETE" ? 204 : 200)), "all six fetches must resolve with expected unchanged status");
    assert.deepEqual(apiDiagnostics.fetches.filter((entry) => entry.method === "DELETE").map((entry) => [entry.pathname, entry.byteLength]),
      [["/api/presence", 0], ["/api/session", 0]], "logout must delete presence then session exactly once with empty 204 bytes");
    assert.ok(apiDiagnostics.requests.length === 6 && apiDiagnostics.requests.every((entry) => entry.state === "finished"), "all six raw API requests must finish after renderer GC");
    assert.ok(await page.evaluate(() => sessionStorage.getItem("bookstore-news-role") === null
      && sessionStorage.getItem("bookstore-news-session-id") === null), "logout must clear both tab-scoped session markers");
    assert.ok((await page.locator(".toast").allTextContents()).every((toast) => previousToasts.includes(toast)), "logout must not produce a new error toast");
    assert.ok(!activeSession, "mock session must end logged out");
    assert.ok(nodeNetworkAttempts === 0 && externalAttempts === 0 && handlerErrors === 0, "all network activity must stay within synthetic fixture");
    assert.ok(consoleErrors === 0 && pageErrors === 0 && transportFailures === 0, "no console/script/transport errors allowed");
    assert.ok(api.some((entry) => entry.method === "POST") && api.every((entry) => [200, 204].includes(entry.status)), "mock API calls must succeed");
    pass("HTML-COPY-05 zero external/Node network, console/page errors and mock logout");
    console.log(JSON.stringify({ results, runtime, api, clipboardWrites, sourceUnchanged: JSON.stringify(workspace) === sourceBefore,
      externalAttempts, nodeNetworkAttempts, handlerErrors, consoleErrors, pageErrors, transportFailures,
      dataSafety: "All data/API responses synthetic; SSR in-process; built asset bytes only; no server/envfile/DB/remote writes",
      skipped: ["Actual OS clipboard integration", "External editor HTML-LINES-06", "Remote Staging/DB writes",
        "Secondary route SSR/navigation (two inert RSC prefetch mocks)", "Memory/leak audit and resource cycling (test-only change)",
        "Direct browser injected-failure controls (negative cases covered by observer unit tests)"],
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ step, runtime, api, apiDiagnostics: await collectApiDiagnostics(), requestKinds, handlerErrorKinds, transportFailureKinds, externalAttempts, nodeNetworkAttempts, handlerErrors, consoleErrors, pageErrors, transportFailures }));
    throw error;
  } finally {
    for (const download of downloads) await download.delete().catch(() => undefined);
    for (const context of contexts.reverse()) await context.close().catch(() => undefined);
    await browser.close();
  }
}
