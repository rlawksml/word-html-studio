import { consumeOwnedCleanupPlan, cleanupTargetKey, matchesCleanupSnapshot } from "./owned-cleanup-plan.mjs";

function failure(code, attemptedDeletes = 0) {
  const error = new Error(`${code}; attemptedDeletes=${attemptedDeletes}`);
  error.code = code;
  error.attemptedDeletes = attemptedDeletes;
  return error;
}

/**
 * Mock-only fail-stop executor. All evidence/step preflights precede any delete.
 * No live ownership adapter, atomicity, rollback or TOCTOU guarantee is provided.
 * Delete responses require selected exact snapshots; undefined is NOT success.
 * Only typed verification callbacks may resolve undefined (assertion semantics).
 */
export async function runExactCleanup(plan, steps) {
  let state;
  try { state = consumeOwnedCleanupPlan(plan); } catch { throw failure("CLEANUP_PLAN_REJECTED"); }
  if (!Array.isArray(steps) || steps.length === 0) throw failure("CLEANUP_STEPS_REJECTED");
  const expected = new Map(state.expected.map((row) => [cleanupTargetKey(row.target), row]));
  // Copy callback references before any callback can mutate the caller's steps.
  const checked = steps.map((step) => {
    if (!step || !["delete", "verify"].includes(step.kind) || !expected.has(step.targetKey)
      || typeof step.preflight !== "function" || typeof step.run !== "function") throw failure("CLEANUP_STEPS_REJECTED");
    return { kind: step.kind, targetKey: step.targetKey, preflight: step.preflight, run: step.run };
  });
  const deletes = checked.filter((step) => step.kind === "delete");
  const deleteKeys = deletes.map((step) => step.targetKey);
  if (deleteKeys.length !== state.keys.length || new Set(deleteKeys).size !== deleteKeys.length
    || state.keys.some((key) => !deleteKeys.includes(key))) throw failure("CLEANUP_STEPS_REJECTED");
  for (const target of state.targets) {
    if (target.parentKey !== null && deleteKeys.indexOf(cleanupTargetKey(target)) > deleteKeys.indexOf(target.parentKey)) {
      throw failure("CLEANUP_ORDER_REJECTED");
    }
  }
  // Verification callbacks run only after all deletes, never between child/parent.
  const firstVerify = checked.findIndex((step) => step.kind === "verify");
  if (firstVerify !== -1 && checked.slice(firstVerify).some((step) => step.kind !== "verify")) throw failure("CLEANUP_ORDER_REJECTED");
  for (const step of checked) {
    let result;
    try { result = await step.preflight(); } catch { throw failure("CLEANUP_PREFLIGHT_REJECTED"); }
    if (!matchesCleanupSnapshot(result, expected.get(step.targetKey))) throw failure("CLEANUP_PREFLIGHT_REJECTED");
  }
  let attemptedDeletes = 0;
  for (const step of checked) {
    let result;
    if (step.kind === "delete") attemptedDeletes += 1;
    try { result = await step.run(); } catch { throw failure("CLEANUP_STEP_FAILED", attemptedDeletes); }
    if (step.kind === "delete" ? !matchesCleanupSnapshot(result, expected.get(step.targetKey)) : result !== undefined) {
      throw failure("CLEANUP_STEP_UNCONFIRMED", attemptedDeletes);
    }
  }
  return Object.freeze({ attemptedDeletes, verified: checked.filter((step) => step.kind === "verify").length });
}

function rows(result) {
  if (!result || result.error !== null || !Array.isArray(result.data)
    || Array.from(result.data).some((row) => !row || typeof row !== "object" || Array.isArray(row) || !("id" in row)
      || !["string", "number"].includes(typeof row.id) || row.id === "" || (typeof row.id === "number" && !Number.isFinite(row.id)))) {
    throw failure("ABSENCE_RESPONSE_UNKNOWN");
  }
  return result.data;
}

/** No null/missing/error responses or malformed elements count as absence. */
export async function assertRowsAbsent(operation) {
  let result;
  try { result = await operation; } catch { throw failure("ABSENCE_QUERY_FAILED"); }
  if (rows(result).length !== 0) throw failure("ROWS_REMAIN");
}

/**
 * Full object paths are folder + exact leaf name, never a substring match.
 * A bounded list at its limit is inconclusive, even if the name was not returned.
 */
export async function assertStorageObjectAbsent(bucket, objectPath) {
  if (typeof objectPath !== "string" || objectPath.startsWith("/") || objectPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw failure("STORAGE_PATH_REJECTED");
  }
  const segments = objectPath.split("/");
  const name = segments.pop();
  const folder = segments.join("/");
  if (!name || !folder || typeof bucket?.list !== "function") throw failure("STORAGE_PATH_REJECTED");
  let result;
  try { result = await bucket.list(folder, { limit: 100, search: name }); } catch { throw failure("ABSENCE_QUERY_FAILED"); }
  if (!result || result.error !== null || !Array.isArray(result.data) || result.data.length >= 100
    || Array.from(result.data).some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.name !== "string" || !entry.name || entry.name.includes("/") || [".", ".."].includes(entry.name))) {
    throw failure("STORAGE_ABSENCE_UNKNOWN");
  }
  if (result.data.some((entry) => `${folder}/${entry.name}` === objectPath)) throw failure("STORAGE_OBJECT_REMAINS");
}
