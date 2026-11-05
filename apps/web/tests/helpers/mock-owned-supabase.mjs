// Explicit fake PostgREST subset for installed-SDK unit tests. No network/SDK/env
// access and no DELETE/cascade implementation: retained fixtures are not cleanup.
// Generated updated_at is a fake protocol contract, NOT proof of SQL defaults,
// triggers, migrations or actual schema behavior.
import { canonical, immutable } from "./test-owned-ledger.mjs";

export function createMemorySupabaseMock(seed = {}) {
  const db = { bookstores: structuredClone(seed.bookstores ?? []), submissions: structuredClone(seed.submissions ?? []) };
  const calls = [];
  const faults = [];
  let tick = 0;
  function revision() { return new Date(Date.UTC(2026, 10, 1, 0, 0, ++tick)).toISOString(); }
  function reply(data, status, count, offset = 0) {
    const headers = { "content-type": "application/json" };
    if (count !== undefined) headers["content-range"] = Array.isArray(data) && data.length
      ? `${offset}-${offset + data.length - 1}/${count}` : `*/${count}`;
    return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
  }
  function matches(row, params) {
    for (const [key, value] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      if (value.startsWith("eq.")) { if (String(row[key]) !== value.slice(3)) return false; }
      else if (value.startsWith("like.")) {
        if (typeof row[key] !== "string" || !row[key].includes(value.slice(5).replace(/^[%*]|[%*]$/g, ""))) return false;
      } else throw new Error("FAKE_FILTER_UNSUPPORTED");
    }
    return true;
  }
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const table = url.pathname.split("/").pop();
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push(immutable({ url: url.href, method, headers, body, redirect: init.redirect ?? null }));
    if (!Object.hasOwn(db, table) || !["GET", "POST", "PATCH"].includes(method)) throw new Error("FAKE_OPERATION_UNSUPPORTED");
    const faultIndex = faults.findIndex((fault) => fault.method === method);
    const fault = faultIndex === -1 ? null : faults.splice(faultIndex, 1)[0];
    if (fault?.mode === "throw") throw new Error("synthetic-sensitive-error-do-not-print");
    if (fault?.mode === "error") return reply({ code: "FAKE_CONFLICT", message: "synthetic-sensitive-error-do-not-print" }, 409);
    if (fault?.mode === "redirect") return new Response(null, { status: 302, headers: { location: "https://never-follow.invalid" } });
    let data;
    let status = 200;
    let count;
    let responseOffset = 0;
    if (method === "GET") {
      data = db[table].filter((row) => matches(row, url.searchParams)).sort((a, b) => a.id - b.id);
      count = data.length;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      responseOffset = offset;
      const limit = Number(url.searchParams.get("limit") ?? data.length);
      data = data.slice(offset, offset + limit);
      if (data.length < count) status = 206;
    } else if (method === "POST") {
      if (!body || db[table].some((row) => row.id === body.id)) return reply({ code: "23505", message: "duplicate id" }, 409);
      const row = { ...structuredClone(body), updated_at: revision() };
      db[table].push(row); data = [row]; status = 201;
    } else {
      data = [];
      for (const row of db[table]) if (matches(row, url.searchParams)) {
        Object.assign(row, structuredClone(body), { updated_at: revision() }); data.push(row);
      }
    }
    data = structuredClone(data);
    if (fault?.mode === "lost") throw new Error("synthetic-response-lost-after-write");
    if (fault?.mode === "empty") data = [];
    if (fault?.mode === "null") data = null;
    if (fault?.mode === "204") { data = null; status = 204; }
    if (fault?.transform) data = fault.transform(data);
    if (fault?.mode === "missing-count") count = undefined;
    return reply(data, status, count, responseOffset);
  };
  return Object.freeze({
    mockFetch,
    calls,
    faultNext: (fault) => faults.push(fault),
    rows: (table) => immutable(db[table]),
    mutate(table, id, patch) {
      const row = db[table].find((item) => item.id === id);
      if (!row) throw new Error("FAKE_ROW_MISSING");
      Object.assign(row, structuredClone(patch));
    },
    canonicalState: () => canonical(db),
  });
}
