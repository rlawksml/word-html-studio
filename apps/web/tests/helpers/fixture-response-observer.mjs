// Self-contained for Playwright addInitScript; synthetic fixture use only.
export function installFixtureResponseObserver({ origin }, target = globalThis) {
  if (origin !== "https://html-copy.fixture.invalid") throw new Error("Only the synthetic HTML fixture origin is allowed");
  const expected = new Map([
    ["GET /api/workspace", 200], ["GET /api/session", 200], ["POST /api/session", 200],
    ["DELETE /api/session", 204], ["POST /api/presence", 200], ["DELETE /api/presence", 204],
  ]);
  const nativeFetch = target.fetch, records = [], occurrences = new Map(), maxBytes = 1024 * 1024;
  let observerErrors = 0;
  const now = () => Math.round(target.performance.now() * 1000) / 1000;
  Object.defineProperty(target, "__fixtureFetchDiagnostics", { get: () => records.map((entry) => ({ ...entry })) });
  Object.defineProperty(target, "__fixtureResponseObserverErrors", { get: () => observerErrors });
  target.fetch = function (...args) {
    let record, expectedStatus;
    try {
      const input = args[0], isRequest = target.Request && input instanceof target.Request;
      const url = new URL(isRequest ? input.url : String(input), target.location.href);
      const method = String(args[1]?.method || (isRequest ? input.method : "GET")).toUpperCase();
      const key = `${method} ${url.pathname}`;
      if (url.origin === origin && expected.has(key)) {
        expectedStatus = expected.get(key);
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        record = { key: `${key} #${occurrence}`, pathname: url.pathname, method,
          state: "pending", observerState: "pending", startedMs: now() };
        records.push(record);
      }
    } catch { /* Preserve native handling of unsupported fetch inputs. */ }
    const fail = (kind) => {
      observerErrors++;
      Object.assign(record, { observerState: "failed", observerError: kind, observedMs: now() });
    };
    const settle = (state) => {
      Object.assign(record, { state, settledMs: now(), timingMs: Math.round((now() - record.startedMs) * 1000) / 1000 });
    };
    try {
      const result = Reflect.apply(nativeFetch, this, args);
      if (record) result.then(async (response) => {
        settle("resolved");
        Object.assign(record, { status: response.status, ok: response.ok, bodyNull: response.body === null });
        if (response.status !== expectedStatus || !response.ok) return fail("unexpected-status");
        let stage = "clone-failed";
        try {
          // Independent observer: application keeps the original Promise/Response.
          // Count bytes, not text: even a BOM is invalid content for a mock 204.
          // Read one chunk at a time; never accumulate an unbounded fixture body.
          const clone = response.clone();
          stage = "drain-failed";
          record.byteLength = 0;
          if (clone.body) {
            const reader = clone.body.getReader();
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                record.byteLength += chunk.value.byteLength;
                if (record.byteLength > maxBytes || (expectedStatus === 204 && record.byteLength !== 0)) {
                  void reader.cancel().catch(() => undefined);
                  return fail(record.byteLength > maxBytes ? "body-limit-exceeded" : "nonempty-204");
                }
              }
            } finally { reader.releaseLock(); }
          }
          Object.assign(record, { observerState: "completed", observedMs: now() });
        } catch { fail(stage); }
      }, () => { settle("rejected"); fail("fetch-rejected"); });
      return result;
    } catch (error) {
      if (record) { settle("threw"); fail("fetch-threw"); }
      throw error;
    }
  };
}
