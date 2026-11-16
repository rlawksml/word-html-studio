// Separate contract from the HTML-copy observer: PUT is allowed only here.
// Preserve the original fetch Promise and Response; observe a bounded clone.
export function installDigestResponseObserver({ origin, observeOrder = true }, target = globalThis) {
  if (origin !== "https://digest.fixture.invalid") throw new Error("Only digest fixture origin is allowed");
  if (typeof observeOrder !== "boolean") throw new Error("observeOrder must be boolean");
  const expected = new Map([
    ["GET /api/workspace", 200], ["GET /api/session", 200], ["POST /api/session", 200],
    ["DELETE /api/session", 204], ["POST /api/presence", 200], ["DELETE /api/presence", 204],
    ["PUT /api/submissions", 200],
  ]);
  if (observeOrder) {
    expected.set("GET /api/digest-order", 200);
    expected.set("PUT /api/digest-order", 200);
  }
  const nativeFetch = target.fetch, records = [], occurrences = new Map();
  let errors = 0;
  Object.defineProperty(target, "__digestFetchDiagnostics", { get: () => records.map((item) => ({ ...item })) });
  Object.defineProperty(target, "__digestObserverErrors", { get: () => errors });
  target.fetch = function (...args) {
    let record, status;
    try {
      const input = args[0], isRequest = target.Request && input instanceof target.Request;
      const url = new URL(isRequest ? input.url : String(input), target.location.href);
      const method = String(args[1]?.method || (isRequest ? input.method : "GET")).toUpperCase();
      const key = `${method} ${url.pathname}`;
      if (url.origin === origin && expected.has(key)) {
        status = expected.get(key);
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        record = { key: `${key} #${occurrence}`, method, pathname: url.pathname, state: "pending", observerState: "pending" };
        records.push(record);
      }
    } catch { /* Leave native unsupported-input behavior untouched. */ }
    const fail = (reason) => { errors++; Object.assign(record, { observerState: "failed", reason }); };
    try {
      const promise = Reflect.apply(nativeFetch, this, args);
      if (record) promise.then(async (response) => {
        Object.assign(record, { state: "resolved", status: response.status, byteLength: 0 });
        if (!response.ok || response.status !== status) return fail("unexpected-status");
        try {
          const clone = response.clone();
          if (clone.body) {
            const reader = clone.body.getReader();
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                record.byteLength += chunk.value.byteLength;
                if (record.byteLength > 1024 * 1024 || (status === 204 && record.byteLength)) {
                  void reader.cancel().catch(() => undefined);
                  return fail("invalid-body-size");
                }
              }
            } finally { reader.releaseLock(); }
          }
          record.observerState = "completed";
        } catch { fail("clone-drain-failed"); }
      }, () => { record.state = "rejected"; fail("fetch-rejected"); });
      return promise;
    } catch (error) {
      if (record) { record.state = "threw"; fail("fetch-threw"); }
      throw error;
    }
  };
}
