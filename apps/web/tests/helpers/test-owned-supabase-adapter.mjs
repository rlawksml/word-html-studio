import { assertIntegrationTarget } from "./integration-target-guard.mjs";
import { assertRequestedRow, canonical, createTestOwnedLedger, immutable, qaMarker } from "./test-owned-ledger.mjs";

const tables = ["bookstores", "submissions"];
const syntheticKey = "synthetic-fixed-fake-key-not-valid-for-live-supabase";
const fail = (code) => { throw new Error(code); };
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function assertNoPhotos(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((["images", "photos"].includes(key) && (!Array.isArray(child) || child.length > 0))
      || (["originalPath", "previewPath", "original_path", "preview_path", "storage_path"].includes(key) && child)) fail("PHOTOS_UNSUPPORTED");
    assertNoPhotos(child);
  }
}

function resultRows(result, statuses = [200]) {
  if (!result || !statuses.includes(result.status) || result.error !== null || !Array.isArray(result.data)
    || Array.from(result.data).some((row) => !isObject(row))) fail("SDK_RESPONSE_UNCONFIRMED");
  return result.data;
}

/**
 * RETAIN-ONLY MOCK harness, not a live entry point or security sandbox. Mandatory
 * caller-controlled fetch is a test contract, not proof a callback cannot network.
 * No environment/key inputs, delete operation, Storage support or cleanup plan.
 * REST checks are not transactional ownership/TOCTOU guarantees.
 * Fake revision generation does not establish SQL defaults/triggers or schema behavior.
 */
export async function createMockOnlySupabaseAdapter(options) {
  const allowed = ["target", "mockFetch", "runId", "pageSize", "maxPages"];
  if (!isObject(options) || Object.keys(options).some((key) => !allowed.includes(key))
    || typeof options.mockFetch !== "function" || options.mockFetch === globalThis.fetch) fail("MOCK_FETCH_REQUIRED");
  const target = immutable(options.target);
  const targetFields = ["APP_ENV", "SUPABASE_URL", "EXPECTED_SUPABASE_PROJECT_REF", "BLOCKED_SUPABASE_PROJECT_REFS"];
  if (Object.keys(target).some((key) => !targetFields.includes(key))) fail("TARGET_CONFIG_REJECTED");
  assertIntegrationTarget(target); // Before loading/constructing the installed SDK.
  const { runId, mockFetch } = options;
  const ledger = createTestOwnedLedger(runId);
  const pageSize = options.pageSize ?? 2;
  const maxPages = options.maxPages ?? 10;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) fail("PAGINATION_CONFIG_REJECTED");
  const safeFetch = async (input, init = {}) => {
    assertIntegrationTarget(target); // Validate every SDK URL independently.
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== new URL(target.SUPABASE_URL).origin || url.username || url.password || url.hash
      || !/^\/rest\/v1\/(bookstores|submissions)$/.test(url.pathname)
      || !["GET", "POST", "PATCH"].includes(method)) fail("MOCK_REQUEST_REJECTED");
    const response = await mockFetch(url.href, { ...init, redirect: "error" });
    if (!(response instanceof Response) || response.redirected || (response.status >= 300 && response.status < 400)) fail("MOCK_REDIRECT_REJECTED");
    return response;
  };
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(target.SUPABASE_URL, syntheticKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: safeFetch },
  });
  let baseline = null;
  let busy = false;
  async function singleFlight(operation) {
    if (busy) fail("ADAPTER_BUSY");
    busy = true; // Synchronous acquisition, before the operation's first await.
    try { return await operation(); } finally { busy = false; }
  }
  function supported(table) { if (!tables.includes(table)) fail("TABLE_UNSUPPORTED"); }
  async function list(table) {
    supported(table);
    const all = [];
    let count;
    for (let page = 0; page < maxPages; page++) {
      const result = await client.from(table).select("*", { count: "exact" }).order("id").range(page * pageSize, (page + 1) * pageSize - 1).retry(false);
      const data = resultRows(result, [200, 206]);
      if (!Number.isSafeInteger(result.count) || result.count < 0 || (count !== undefined && count !== result.count)) fail("PAGINATION_UNCONFIRMED");
      count = result.count;
      for (const row of data) {
        if (!Number.isSafeInteger(row.id) || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) fail("ROW_SHAPE_UNCONFIRMED");
        canonical(row);
      }
      all.push(...data);
      if (new Set(all.map((row) => row.id)).size !== all.length || all.length > count) fail("PAGINATION_UNCONFIRMED");
      if (all.length === count) return immutable(all);
      if (data.length < pageSize) fail("PAGINATION_UNCONFIRMED");
    }
    return fail("PAGINATION_INCOMPLETE");
  }
  async function snapshot() { return { bookstores: await list("bookstores"), submissions: await list("submissions") }; }
  async function exact(table, id) { return resultRows(await client.from(table).select("*").eq("id", id).retry(false)); }
  function records() {
    const rows = ledger.records();
    if (rows.some(({ record }) => record.state !== "confirmed")) fail("LEDGER_NOT_CONFIRMED");
    return rows;
  }
  async function assertBaseline() {
    if (!baseline) fail("BASELINE_REQUIRED");
    const current = await snapshot();
    const owned = records();
    for (const table of tables) {
      const own = owned.filter(({ record }) => record.spec.table === table);
      for (const { handle, record } of own) {
        const row = current[table].find((item) => item.id === record.spec.id);
        if (!row || canonical(row) !== canonical(record.latest)) { ledger.markUncertain(handle); fail("OWNED_ROW_CHANGED"); }
      }
      const unowned = current[table].filter((row) => !own.some(({ record }) => record.spec.id === row.id));
      if (canonical(unowned) !== canonical(baseline[table])) fail("BASELINE_CHANGED");
    }
    return current;
  }
  async function create(table, input) {
    const requested = immutable(input); // Caller mutation across awaits is not DB TOCTOU.
    return singleFlight(async () => {
    supported(table);
    if (!isObject(requested) || Object.hasOwn(requested, "updated_at")) fail("CREATE_INPUT_REJECTED");
    assertNoPhotos(requested);
    const current = await assertBaseline();
    if (records().some(({ record }) => record.spec.table === table)) fail("FIXTURE_LIMIT_REACHED");
    if (current[table].some((row) => row.id === requested.id) || (await exact(table, requested.id)).length !== 0) fail("ID_COLLISION");
    const markerField = table === "bookstores" ? "name" : "monthly_notice";
    const row = { ...requested, [markerField]: `${qaMarker(runId)} ${requested[markerField] ?? ""}` };
    const spec = { table, id: row.id, parentId: table === "submissions" ? row.bookstore_id : null, month: table === "submissions" ? row.month : null };
    if (table === "submissions" && !records().some(({ record }) => record.spec.table === "bookstores" && record.spec.id === spec.parentId)) fail("OWNED_PARENT_REQUIRED");
    assertRequestedRow(spec, row, runId); // No revision is invented before a receipt.
    const handle = ledger.intent(spec, row);
    try {
      const result = await client.from(table).insert(row).select("*").retry(false);
      const confirmed = ledger.confirmCreate(handle, result);
      return Object.freeze({ handle, row: confirmed });
    } catch { ledger.markUncertain(handle); return fail("CREATE_UNCERTAIN"); }
    });
  }
  function cas(query, record) {
    const { spec, latest } = record;
    const markerField = spec.table === "bookstores" ? "name" : "monthly_notice";
    let filtered = query.eq("id", spec.id).eq("updated_at", latest.updated_at)
      .eq(markerField, latest[markerField]);
    if (spec.table === "submissions") filtered = filtered.eq("bookstore_id", spec.parentId).eq("month", spec.month);
    return filtered;
  }
  return Object.freeze({
    async captureBaseline() {
      return singleFlight(async () => {
      if (baseline || ledger.records().length) fail("BASELINE_ALREADY_CAPTURED");
      baseline = immutable(await snapshot());
      return baseline;
      });
    },
    createBookstore: (row) => create("bookstores", row),
    createSubmission: (row) => create("submissions", row),
    async createUnsupported() { return fail("TABLE_OR_STORAGE_UNSUPPORTED"); },
    async update(handle, patch) {
      const requested = immutable(patch);
      return singleFlight(async () => {
      const record = ledger.record(handle);
      if (record.state !== "confirmed") fail("LEDGER_NOT_CONFIRMED");
      const fields = record.spec.table === "bookstores" ? ["name", "introduction"] : ["monthly_notice", "news"];
      if (!isObject(requested) || Object.keys(requested).some((key) => !fields.includes(key))) fail("UPDATE_INPUT_REJECTED");
      assertNoPhotos(requested);
      await assertBaseline();
      const next = { ...record.latest, ...requested };
      const markerField = record.spec.table === "bookstores" ? "name" : "monthly_notice";
      if (typeof next[markerField] !== "string") fail("UPDATE_INPUT_REJECTED");
      if (!next[markerField].includes(qaMarker(runId))) next[markerField] = `${qaMarker(runId)} ${next[markerField]}`;
      ledger.beginCAS(handle, next);
      const body = { ...next }; delete body.updated_at;
      try {
        const result = await cas(client.from(record.spec.table).update(body), record).select("*").retry(false);
        return ledger.confirmUpdate(handle, result);
      } catch { ledger.markUncertain(handle); return fail("UPDATE_UNCERTAIN"); }
      });
    },
    async read(handle) {
      const record = ledger.record(handle);
      const rows = await exact(record.spec.table, record.spec.id);
      if (rows.length !== 1) fail("READ_UNCONFIRMED");
      return immutable(rows[0]); // Observation NEVER promotes uncertain state.
    },
    record: (handle) => ledger.record(handle),
    records: () => immutable(ledger.records().map(({ record }) => record)),
    rows: list,
    assertBaseline,
    cleanup() { return fail("RETAIN_ONLY_DELETION_UNSUPPORTED"); },
  });
}
