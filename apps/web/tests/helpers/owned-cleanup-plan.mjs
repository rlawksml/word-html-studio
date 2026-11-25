// Pure, mock-only evidence consistency checks. NOT an adapter, authorization,
// transaction, or proof that caller-supplied observations came from a live DB.
const plans = new WeakMap();
const fail = () => { throw new Error("CLEANUP_EVIDENCE_REJECTED"); };
const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 512;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const tables = new Set(["bookstores", "submissions", "news_schedule_ranges", "editing_leases", "improvement_requests"]);
const buckets = new Set(["bookstore-news-originals", "bookstore-news-previews"]);

// Always throws. No env, target validation or caller flag can unlock legacy I/O.
export function assertLegacyIntegrationBlocked() {
  throw new Error("SUPABASE_INTEGRATION_BLOCKED_UNSAFE_LEGACY_CLEANUP");
}

function exactKeys(value, names) {
  if (!object(value) || Object.keys(value).sort().join() !== [...names].sort().join()) fail();
}

function pathValid(value) {
  return text(value) && !value.startsWith("/") && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function identity(target) {
  if (!object(target)) fail();
  const common = ["kind", "parentKey", "month"];
  if (target.kind === "row") {
    exactKeys(target, [...common, "table", "id"]);
    if (!tables.has(target.table) || !text(target.id)) fail();
  } else if (target.kind === "storage") {
    exactKeys(target, [...common, "bucket", "path"]);
    if (!buckets.has(target.bucket) || !pathValid(target.path)) fail();
  } else fail();
  if (target.parentKey !== null && !text(target.parentKey)) fail();
  if (target.month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(target.month)) fail();
  return JSON.stringify(target.kind === "row" ? ["row", target.table, target.id] : ["storage", target.bucket, target.path]);
}

export function cleanupTargetKey(target) { return identity(target); }

function scope(target) {
  return JSON.stringify([target.kind, target.kind === "row" ? target.table : target.bucket]);
}

function sameSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((item) => !text(item)) || new Set(actual).size !== actual.length
    || actual.length !== expected.length || expected.some((item) => !actual.includes(item))) fail();
}

function snapshot(value) {
  exactKeys(value, ["target", "revision", "marker"]);
  identity(value.target);
  if (!text(value.revision) || !text(value.marker)) fail();
  return value;
}

function sameTarget(a, b) {
  return identity(a) === identity(b) && a.parentKey === b.parentKey && a.month === b.month;
}

function sameSnapshot(a, b) {
  return sameTarget(a.target, b.target) && a.revision === b.revision && a.marker === b.marker;
}

function complete(result, field, expected) {
  if (!object(result) || result.error !== null || !Array.isArray(result.data) || result.complete !== true) fail();
  sameSet(result[field], expected);
  return result.data;
}

/**
 * Evidence must be complete, scoped observations, not () => true / created flags.
 * Latest rows must include an explicit revision and run marker, with exact lineage.
 * Stage 1 intentionally has no live producer/adapter for this normalized schema.
 */
export function issueOwnedCleanupPlan(evidence) {
  if (!object(evidence) || !text(evidence.runId) || !Array.isArray(evidence.targets) || evidence.targets.length === 0) fail();
  const targets = structuredClone(evidence.targets);
  const keys = targets.map(identity);
  if (new Set(keys).size !== keys.length) fail();
  const scopes = [...new Set(targets.map(scope))];
  const targetMap = new Map(targets.map((target) => [identity(target), target]));
  for (const target of targets) {
    if (target.parentKey !== null) {
      const parent = targetMap.get(target.parentKey);
      if (!parent || parent.kind !== "row" || (parent.month !== null && parent.month !== target.month)) fail();
      const seen = new Set([identity(target)]);
      let cursor = parent;
      while (cursor) {
        const key = identity(cursor);
        if (seen.has(key)) fail();
        seen.add(key);
        cursor = cursor.parentKey === null ? null : targetMap.get(cursor.parentKey);
      }
    } else if (target.kind === "storage") fail();
  }
  const baseline = complete(evidence.baseline, "scopes", scopes);
  for (const entry of baseline) {
    snapshot(entry);
    if (!scopes.includes(scope(entry.target)) || keys.includes(identity(entry.target))) fail();
  }
  const latest = complete(evidence.latest, "keys", keys).map(snapshot);
  sameSet(latest.map((entry) => identity(entry.target)), keys);
  const latestMap = new Map(latest.map((entry) => [identity(entry.target), entry]));
  if (!Array.isArray(evidence.creations) || evidence.creations.length !== keys.length) fail();
  const createdKeys = [];
  for (const creation of evidence.creations) {
    if (!object(creation) || creation.error !== null || creation.status !== 201 || !Array.isArray(creation.data) || creation.data.length !== 1) fail();
    const created = snapshot(creation.data[0]);
    const key = identity(created.target);
    const current = latestMap.get(key);
    // Stage 1 has no update-receipt adapter: even same-run revision drift refuses.
    if (!current || !sameTarget(current.target, targetMap.get(key)) || !sameSnapshot(created, current)
      || created.marker !== evidence.runId || current.marker !== evidence.runId) fail();
    createdKeys.push(key);
  }
  sameSet(createdKeys, keys);
  const rowKeys = targets.filter((target) => target.kind === "row").map(identity);
  const children = complete(evidence.children, "parents", rowKeys);
  const expectedEdges = targets.filter((target) => target.parentKey !== null).map((target) => `${target.parentKey}\n${identity(target)}`);
  const edges = children.map((edge) => {
    exactKeys(edge, ["parentKey", "childKey"]);
    if (!text(edge.parentKey) || !text(edge.childKey)) fail();
    return `${edge.parentKey}\n${edge.childKey}`;
  });
  sameSet(edges, expectedEdges);
  const storageKeys = targets.filter((target) => target.kind === "storage").map(identity);
  const references = complete(evidence.storageReferences, "paths", storageKeys);
  if (references.length !== 0) fail();
  // Snapshot evidence, then keep it private. Mutation or serialization cannot mint plans.
  const plan = Object.freeze(Object.create(null));
  plans.set(plan, { used: false, keys, expected: structuredClone(latest), targets });
  return plan;
}

// Consumed even when preflight fails: retry needs a new set of observations.
export function consumeOwnedCleanupPlan(plan) {
  const state = object(plan) ? plans.get(plan) : undefined;
  if (!state || state.used || !Object.isFrozen(plan)) throw new Error("CLEANUP_PLAN_REJECTED");
  state.used = true;
  return structuredClone({ keys: state.keys, expected: state.expected, targets: state.targets });
}

export function matchesCleanupSnapshot(result, expected) {
  try {
    return object(result) && result.error === null && Array.isArray(result.data) && result.data.length === 1
      && sameSnapshot(snapshot(result.data[0]), expected);
  } catch { return false; }
}
