// Synthetic built-UI harness: no listener, remote origin, env files or user profile.
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

const ORIGINS = new Set(["https://digest.fixture.invalid", "https://images.fixture.invalid"]);
const MIME = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

export async function runIsolatedFixture(entry, run) {
  if (!process.argv.includes("--isolated-child")) {
    const selected = ["PLAYWRIGHT_MODULE_PATH", "PLAYWRIGHT_BROWSERS_PATH"]
      .filter((name) => process.env[name]).map((name) => `${name}=${process.env[name]}`);
    const child = spawn("/usr/bin/env", ["-i", "PATH=/usr/bin:/bin", ...selected,
      process.execPath, fileURLToPath(entry), "--isolated-child"], { cwd: process.cwd(), stdio: "inherit" });
    child.on("error", () => { console.error("FAIL isolated fixture process"); process.exitCode = 1; });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
    return;
  }
  // Never print exception bodies, request bodies, headers, session IDs or URLs.
  try { await run(); } catch (error) {
    console.error(`FAIL synthetic fixture (${error?.code === "ERR_ASSERTION" ? "assertion" : "environment/automation"})`);
    process.exitCode = 1;
  }
}

export async function createBuiltSsrFixture({ origin, api, observer }) {
  assert.ok(process.argv.includes("--isolated-child"), "fixture requires scrubbed child process");
  assert.ok(ORIGINS.has(origin), "fixture origin must be explicitly synthetic");
  const counts = { nodeNetworkAttempts: 0, externalAttempts: 0, handlerErrors: 0,
    consoleErrors: 0, pageErrors: 0, transportFailures: 0 };
  const deny = () => { counts.nodeNetworkAttempts++; throw new Error("Fixture Node network denied"); };
  globalThis.fetch = async () => deny();
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = tls.connect = deny;
  syncBuiltinESMExports();
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
  const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
  const require = createRequire(modulePath ? pathToFileURL(modulePath) : import.meta.url);
  const version = require(modulePath ? "./package.json" : "playwright/package.json").version;
  const web = resolve(process.cwd());
  const { default: worker } = await import(pathToFileURL(resolve(web, "dist/server/index.js")).href);
  const clientRoot = await realpath(resolve(web, "dist/client"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  if (observer) await context.addInitScript(observer, { origin });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const records = [], requests = new Map(), occurrences = new Map(), history = [];
  const apiPathnames = ["/api/session", "/api/workspace", "/api/presence", "/api/submissions"];
  page.on("console", (message) => { if (message.type() === "error") counts.consoleErrors++; });
  page.on("pageerror", () => { counts.pageErrors++; });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || !apiPathnames.includes(url.pathname)) return;
    const key = `${request.method()} ${url.pathname}`;
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    const record = { key: `${key} #${occurrence}`, method: request.method(), pathname: url.pathname,
      state: "pending", startedMs: Math.round(performance.now()) };
    records.push(record);
    requests.set(request, record);
  });
  page.on("response", (response) => {
    const record = requests.get(response.request());
    if (record) record.status = response.status();
  });
  const complete = (request, state) => {
    const record = requests.get(request);
    if (record) Object.assign(record, { state, timingMs: Math.round(performance.now()) - record.startedMs });
  };
  page.on("requestfinished", (request) => complete(request, "finished"));
  page.on("requestfailed", (request) => { counts.transportFailures++; complete(request, "failed"); });
  const cdp = await context.newCDPSession(page);
  cdp.on("Fetch.requestPaused", (event) => { void handle(event).catch(() => { counts.handlerErrors++; }); });
  async function handle({ request, requestId }) {
    const fulfill = (status, contentType, body = "") => cdp.send("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{ name: "Cache-Control", value: "no-store" }, ...(status === 204
        ? [{ name: "Content-Length", value: "0" }] : [{ name: "Content-Type", value: contentType }])],
      ...(status === 204 ? {} : { body: Buffer.from(body).toString("base64") }),
    });
    try {
      const url = new URL(request.url);
      if (url.origin !== origin) {
        counts.externalAttempts++;
        return cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
      if (url.pathname.startsWith("/api/")) {
        assert.equal(url.search, "", "fixture API paths cannot carry query data");
        const result = await api({ pathname: url.pathname, method: request.method,
          headers: request.headers, body: request.postData ? JSON.parse(request.postData) : null });
        assert.ok(result && [200, 204].includes(result.status), "mock API result must be explicit");
        history.push({ pathname: url.pathname, method: request.method, status: result.status });
        return fulfill(result.status, "application/json", result.status === 204 ? "" : JSON.stringify(result.body));
      }
      if (request.method === "GET" && url.pathname === "/") {
        const response = await worker.fetch(new Request(origin, { headers: { accept: "text/html" } }),
          { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
          { waitUntil() {}, passThroughOnException() {} });
        assert.equal(response.status, 200, "built SSR root must render");
        return fulfill(200, "text/html; charset=utf-8", Buffer.from(await response.arrayBuffer()));
      }
      // Inert entries only; these navigation destinations are not tested here.
      if (request.method === "GET" && ["/help.rsc", "/improvements.rsc"].includes(url.pathname)) {
        return fulfill(200, "text/x-component", "0:null\n");
      }
      assert.ok(request.method === "GET" && MIME[extname(url.pathname)], "only built asset GET is allowed");
      const candidate = resolve(clientRoot, `.${decodeURIComponent(url.pathname)}`);
      assert.ok(candidate.startsWith(`${clientRoot}${sep}`), "asset must stay inside client root");
      const canonical = await realpath(candidate);
      assert.ok(canonical.startsWith(`${clientRoot}${sep}`), "asset symlink must stay inside client root");
      const info = await stat(canonical);
      assert.ok(info.isFile() && info.size <= 15 * 1024 * 1024, "asset must be a bounded file");
      return fulfill(200, MIME[extname(canonical)], await readFile(canonical));
    } catch {
      counts.handlerErrors++;
      return fulfill(500, "text/plain", "Synthetic fixture failure");
    }
  }
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  async function diagnostics() {
    const deadline = performance.now() + 2_000;
    let observation;
    do {
      observation = await page.evaluate(() => ({
        fetches: window.__digestFetchDiagnostics || [], observerErrors: window.__digestObserverErrors || 0,
      }));
      if (observation.fetches.every((record) => record.observerState !== "pending")
        && records.every((record) => record.state !== "pending")) break;
      await page.waitForTimeout(25);
    } while (performance.now() < deadline);
    return { runtime: { playwright: version, chromium: browser.version() }, counts: { ...counts },
      history: [...history], requests: records.map((record) => ({ ...record })), ...observation };
  }
  return { page, context, diagnostics,
    close: async () => { await context.close(); await browser.close(); } };
}
