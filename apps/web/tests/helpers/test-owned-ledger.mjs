// Test-only normalized acknowledgement ledger. Caller-supplied receipts are not
// proof of live ownership. No DB, environment, SDK, clock or random I/O here.
const supported = new Set(["bookstores", "submissions"]);
const fail = (code) => { throw new Error(code); };
export const qaMarker = (runId) => `[[qa:${runId}]]`;

export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return fail("LEDGER_NON_JSON_VALUE");
}

export function immutable(value) {
  const clone = JSON.parse(canonical(value));
  function freeze(item) {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  }
  return freeze(clone);
}

export function assertSpec(spec) {
  if (!spec || !supported.has(spec.table) || !Number.isSafeInteger(spec.id) || spec.id <= 0) fail("LEDGER_UNSUPPORTED_TARGET");
  if (spec.table === "bookstores") {
    if (spec.parentId !== null || spec.month !== null) fail("LEDGER_LINEAGE_REJECTED");
  } else if (!Number.isSafeInteger(spec.parentId) || spec.parentId <= 0 || spec.month !== "2026-11") fail("LEDGER_LINEAGE_REJECTED");
}

function withoutRevision(row) {
  const copy = { ...row }; delete copy.updated_at; return copy;
}

function assertRowIdentity(spec, row, runId) {
  assertSpec(spec);
  if (!row || typeof row !== "object" || Array.isArray(row) || row.id !== spec.id) fail("LEDGER_ROW_REJECTED");
  const marker = spec.table === "bookstores" ? row.name : row.monthly_notice;
  if (typeof marker !== "string" || !marker.includes(qaMarker(runId))) fail("LEDGER_MARKER_REJECTED");
  if (spec.table === "submissions" && (row.bookstore_id !== spec.parentId || row.month !== spec.month
    || !Array.isArray(row.news) || row.news.length !== 5)) fail("LEDGER_LINEAGE_REJECTED");
  canonical(row); // Preserve the complete row, including unknown JSON fields.
}

export function assertOwnedRow(spec, row, runId) {
  assertRowIdentity(spec, row, runId);
  if (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) fail("LEDGER_ROW_REJECTED");
}

export function assertRequestedRow(spec, row, runId) {
  assertRowIdentity(spec, row, runId);
  if (Object.hasOwn(row, "updated_at")) fail("LEDGER_INTENT_REJECTED");
}

export function createTestOwnedLedger(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(runId)) fail("LEDGER_RUN_REJECTED");
  const entries = new Map();
  const byKey = new Set();
  function entry(handle) {
    const current = entries.get(handle);
    if (!current) fail("LEDGER_HANDLE_REJECTED");
    return current;
  }
  function uncertain(current) { current.state = "uncertain"; current.pending = null; }
  function receipt(current, result, status, requested) {
    if (!result || result.status !== status || result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) fail("LEDGER_RECEIPT_REJECTED");
    const row = result.data[0];
    assertOwnedRow(current.spec, row, runId);
    if (canonical(withoutRevision(row)) !== canonical(withoutRevision(requested))) fail("LEDGER_RECEIPT_MISMATCH");
    return immutable(row);
  }
  return Object.freeze({
    intent(spec, requestedRow) {
      assertSpec(spec);
      const key = `${spec.table}:${spec.id}`;
      if (byKey.has(key)) fail("LEDGER_DUPLICATE_INTENT");
      assertRequestedRow(spec, requestedRow, runId);
      const handle = Object.freeze(Object.create(null));
      entries.set(handle, { state: "intent", spec: immutable(spec), requested: immutable(requestedRow),
        creation: null, updates: [], latest: null, pending: null });
      byKey.add(key);
      return handle;
    },
    confirmCreate(handle, result) {
      const current = entry(handle);
      if (current.state !== "intent") fail("LEDGER_TRANSITION_REJECTED");
      try {
        const row = receipt(current, result, 201, current.requested);
        current.creation = immutable({ status: 201, error: null, data: [row] });
        current.latest = row; current.state = "confirmed";
        return row;
      } catch { uncertain(current); return fail("LEDGER_CREATE_UNCERTAIN"); }
    },
    beginCAS(handle, requestedRow) {
      const current = entry(handle);
      if (current.state !== "confirmed") fail("LEDGER_TRANSITION_REJECTED");
      if (requestedRow?.updated_at !== current.latest.updated_at) fail("LEDGER_EXPECTED_REVISION_REJECTED");
      assertOwnedRow(current.spec, requestedRow, runId);
      current.pending = immutable({ before: current.latest, requested: requestedRow });
      current.state = "pendingCAS";
      return current.pending;
    },
    confirmUpdate(handle, result) {
      const current = entry(handle);
      if (current.state !== "pendingCAS") fail("LEDGER_TRANSITION_REJECTED");
      try {
        const row = receipt(current, result, 200, current.pending.requested);
        if (row.updated_at === current.latest.updated_at) fail("LEDGER_REVISION_NOT_ADVANCED");
        current.updates.push(immutable({ before: current.pending.before, status: 200, error: null, data: [row] }));
        current.latest = row; current.pending = null; current.state = "confirmed";
        return row;
      } catch { uncertain(current); return fail("LEDGER_UPDATE_UNCERTAIN"); }
    },
    markUncertain(handle) { uncertain(entry(handle)); },
    record(handle) {
      const current = entry(handle);
      return immutable({ state: current.state, spec: current.spec, creation: current.creation,
        updates: current.updates, latest: current.latest });
    },
    records() { return [...entries.keys()].map((handle) => ({ handle, record: this.record(handle) })); },
  });
}
