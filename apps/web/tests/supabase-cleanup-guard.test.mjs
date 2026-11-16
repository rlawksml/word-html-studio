import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRowsAbsent,
  assertStorageObjectAbsent,
  runExactCleanup,
} from "./helpers/supabase-cleanup-guard.mjs";
import { cleanupTargetKey, issueOwnedCleanupPlan } from "./helpers/owned-cleanup-plan.mjs";

// Synthetic observations only: these tests cannot authorize a live cleanup.
function fixture() {
  const parent = { kind: "row", table: "bookstores", id: "run-parent", parentKey: null, month: "2099-12" };
  const child = { kind: "row", table: "submissions", id: "run-child", parentKey: cleanupTargetKey(parent), month: "2099-12" };
  const storage = { kind: "storage", bucket: "bookstore-news-originals", path: "run/2099-12/photo.jpg", parentKey: cleanupTargetKey(child), month: "2099-12" };
  const targets = [parent, child, storage];
  const existing = { target: { ...parent, id: "existing-user-row" }, revision: "original", marker: "not-this-run" };
  const latest = targets.map((target) => ({ target, revision: "r2", marker: "run-123" }));
  const keys = targets.map(cleanupTargetKey);
  const evidence = {
    runId: "run-123", targets,
    baseline: { error: null, complete: true, scopes: ['["row","bookstores"]', '["row","submissions"]', '["storage","bookstore-news-originals"]'], data: [existing] },
    creations: latest.map((entry) => ({ error: null, status: 201, data: [structuredClone(entry)] })),
    latest: { error: null, complete: true, keys, data: latest },
    children: { error: null, complete: true, parents: keys.slice(0, 2), data: [
      { parentKey: keys[0], childKey: keys[1] }, { parentKey: keys[1], childKey: keys[2] },
    ] },
    storageReferences: { error: null, complete: true, paths: [keys[2]], data: [] },
  };
  const original = structuredClone(existing);
  const db = new Map([existing, ...latest].map((row) => [cleanupTargetKey(row.target), structuredClone(row)]));
  const calls = [];
  function cascade(key) {
    for (const [childKey, row] of db) if (row.target.parentKey === key) cascade(childKey);
    db.delete(key);
  }
  const steps = [...latest].reverse().map((row) => ({
    kind: "delete", targetKey: cleanupTargetKey(row.target),
    preflight: async () => ({ error: null, data: [structuredClone(db.get(cleanupTargetKey(row.target)))] }),
    run: async () => {
      const key = cleanupTargetKey(row.target);
      calls.push(key);
      const deleted = db.get(key);
      cascade(key);
      return { error: null, data: [deleted] };
    },
  }));
  const assertExisting = () => assert.deepEqual(db.get(cleanupTargetKey(existing.target)), original);
  return { evidence, db, calls, steps, latest, keys, assertExisting };
}

test("owned plan is opaque, frozen, one-shot and snapshots its evidence", async () => {
  const f = fixture();
  const plan = issueOwnedCleanupPlan(f.evidence);
  assert.ok(Object.isFrozen(plan));
  assert.deepEqual(Object.keys(plan), []);
  assert.throws(() => { plan.targets = []; }, TypeError);
  f.evidence.latest.data[0].revision = "mutated-after-issue";
  const result = await runExactCleanup(plan, f.steps);
  assert.deepEqual(result, { attemptedDeletes: 3, verified: 0 });
  assert.deepEqual(f.calls, [...f.keys].reverse());
  await assert.rejects(runExactCleanup(plan, f.steps), /CLEANUP_PLAN_REJECTED/);
  f.assertExisting();
});

test("all evidence inconsistencies reject before any fake cascade call", () => {
  const cases = [
    ["baseline collision", (e) => e.baseline.data.push(structuredClone(e.latest.data[0]))],
    ["incomplete baseline", (e) => { e.baseline.complete = false; }],
    ["missing baseline scope", (e) => e.baseline.scopes.pop()],
    ["baseline unknown", (e) => { e.baseline.data = null; }],
    ["failed creation", (e) => { e.creations[0].error = { message: "secret" }; }],
    ["lost creation response", (e) => { e.creations[0].data = null; }],
    ["flag is not creation proof", (e) => { e.creations[0] = { created: true }; }],
    ["wrong creation marker", (e) => { e.creations[0].data[0].marker = "other-run"; }],
    ["wrong current marker", (e) => { e.latest.data[0].marker = "other-run"; }],
    ["missing current revision", (e) => { delete e.latest.data[0].revision; }],
    ["unconfirmed revision change", (e) => { e.latest.data[0].revision = "r3"; }],
    ["unknown table", (e) => { e.targets[0].table = "unreviewed_table"; }],
    ["unknown bucket", (e) => { e.targets[2].bucket = "unreviewed_bucket"; }],
    ["missing latest row", (e) => e.latest.data.pop()],
    ["month mismatch", (e) => { e.latest.data[1].target.month = "2099-11"; }],
    ["parent mismatch", (e) => { e.latest.data[1].target.parentKey = "unknown-parent"; }],
    ["unknown child", (e) => e.children.data.push({ parentKey: e.latest.keys[0], childKey: "existing-user-child" })],
    ["missing child scan", (e) => { e.children.complete = false; }],
    ["storage still referenced", (e) => e.storageReferences.data.push({ path: "run/2099-12/photo.jpg" })],
    ["missing reference scope", (e) => { e.storageReferences.paths = []; }],
    ["root storage", (e) => { e.targets[2].parentKey = null; }],
  ];
  for (const [label, mutate] of cases) {
    const f = fixture();
    mutate(f.evidence);
    assert.throws(() => issueOwnedCleanupPlan(f.evidence), /CLEANUP_EVIDENCE_REJECTED/, label);
    assert.deepEqual(f.calls, [], label);
    f.assertExisting();
  }
  assert.throws(() => issueOwnedCleanupPlan(() => true), /CLEANUP_EVIDENCE_REJECTED/);
  assert.throws(() => issueOwnedCleanupPlan({ created: true }), /CLEANUP_EVIDENCE_REJECTED/);
});

test("missing, forged, copied and raw legacy plans never call a delete", async () => {
  const f = fixture();
  const issued = issueOwnedCleanupPlan(f.evidence);
  for (const plan of [undefined, true, () => true, { created: true }, Object.freeze({}), structuredClone(issued), new Proxy(issued, {})]) {
    await assert.rejects(runExactCleanup(plan, f.steps), /CLEANUP_PLAN_REJECTED/);
  }
  await assert.rejects(runExactCleanup(f.steps), /CLEANUP_PLAN_REJECTED/);
  assert.deepEqual(f.calls, []);
  f.assertExisting();
});

test("all step structure, order and preflights validate before the first delete", async () => {
  const cases = [
    ["missing guard", (f) => { delete f.steps[2].preflight; }],
    ["missing delete callback", (f) => { delete f.steps[2].run; }],
    ["missing kind", (f) => { delete f.steps[2].kind; }],
    ["missing target", (f) => f.steps.pop()],
    ["duplicate target", (f) => { f.steps[2] = f.steps[0]; }],
    ["parent first", (f) => f.steps.reverse()],
    ["boolean guard", (f) => { f.steps[2].preflight = async () => true; }],
    ["undefined guard", (f) => { f.steps[2].preflight = async () => {}; }],
    ["unknown response", (f) => { f.steps[2].preflight = async () => ({ error: null, data: null }); }],
    ["stale revision", (f) => { f.db.get(f.keys[0]).revision = "concurrent-write"; }],
    ["throwing guard", (f) => { f.steps[2].preflight = async () => { throw new Error("secret"); }; }],
  ];
  for (const [label, mutate] of cases) {
    const f = fixture();
    const plan = issueOwnedCleanupPlan(f.evidence);
    mutate(f);
    await assert.rejects(runExactCleanup(plan, f.steps), (error) => {
      assert.equal(error.attemptedDeletes, 0, label);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
    assert.deepEqual(f.calls, [], label);
    await assert.rejects(runExactCleanup(plan, f.steps), /CLEANUP_PLAN_REJECTED/);
    f.assertExisting();
  }
});

test("first delete error, throw or unknown stops all further child/parent calls", async () => {
  const failures = [
    async () => ({ error: { message: "secret-token" }, data: null }),
    async () => { throw new Error("secret-token"); },
    async () => undefined,
    async () => ({ error: null }),
    async () => ({ error: null, data: [] }),
    async () => ({ error: null, data: [{ created: true }] }),
  ];
  for (const response of failures) {
    const f = fixture();
    const plan = issueOwnedCleanupPlan(f.evidence);
    f.steps[0].run = async () => { f.calls.push(f.keys[2]); return response(); };
    await assert.rejects(runExactCleanup(plan, f.steps), (error) => {
      assert.equal(error.attemptedDeletes, 1);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    });
    assert.deepEqual(f.calls, [f.keys[2]]);
    assert.ok(f.db.has(f.keys[0]), "parent cascade must not run");
    assert.ok(f.db.has(f.keys[1]), "child row must not be deleted after storage failure");
    f.assertExisting();
  }
});

test("typed verification accepts assertion undefined but delete never does", async () => {
  const f = fixture();
  const plan = issueOwnedCleanupPlan(f.evidence);
  f.steps.push({ kind: "verify", targetKey: f.keys[0], preflight: f.steps[2].preflight,
    run: () => assertRowsAbsent(Promise.resolve({ error: null, data: [] }), "ignored") });
  assert.deepEqual(await runExactCleanup(plan, f.steps), { attemptedDeletes: 3, verified: 1 });
  f.assertExisting();
});

test("lost delete response reports one attempted call, not zero or atomic rollback", async () => {
  const f = fixture();
  const plan = issueOwnedCleanupPlan(f.evidence);
  const remove = f.steps[0].run;
  f.steps[0].run = async () => { await remove(); return undefined; };
  await assert.rejects(runExactCleanup(plan, f.steps), (error) => {
    assert.equal(error.attemptedDeletes, 1);
    return error.code === "CLEANUP_STEP_UNCONFIRMED";
  });
  assert.deepEqual(f.calls, [f.keys[2]]);
  assert.equal(f.db.has(f.keys[2]), false, "first deletion can already have happened");
  assert.equal(f.db.has(f.keys[0]), true, "no parent cascade after uncertainty");
  f.assertExisting();
});

test("verification failure stops later verification and retains accurate delete count", async () => {
  const f = fixture();
  const plan = issueOwnedCleanupPlan(f.evidence);
  let laterVerification = 0;
  const verification = { kind: "verify", targetKey: f.keys[0], preflight: f.steps[2].preflight,
    run: async () => { throw new Error("secret-raw-error"); } };
  f.steps.push(verification, { ...verification, run: async () => { laterVerification++; } });
  await assert.rejects(runExactCleanup(plan, f.steps), (error) => {
    assert.equal(error.attemptedDeletes, 3);
    assert.doesNotMatch(error.message, /secret-raw-error/);
    return true;
  });
  assert.equal(laterVerification, 0);
  f.assertExisting();
});

test("row absence accepts only a strict successful empty array", async () => {
  await assert.doesNotReject(assertRowsAbsent(Promise.resolve({ data: [], error: null })));
  const invalid = [undefined, null, {}, { error: null }, { data: [] }, { error: null, data: null },
    { error: "secret", data: [] }, { error: null, data: [null] }, { error: null, data: [{}] },
    { error: null, data: [{ id: null }] }, { error: null, data: [{ id: 1 }] }];
  for (const response of invalid) {
    await assert.rejects(assertRowsAbsent(Promise.resolve(response)), (error) => {
      assert.doesNotMatch(error.message, /secret/); return true;
    });
  }
  await assert.rejects(assertRowsAbsent(Promise.reject(new Error("secret"))), /ABSENCE_QUERY_FAILED/);
});

test("Storage checks full path/exact name; full bounded pages and malformed lists are unknown", async () => {
  const calls = [];
  const path = "originals/2099-12/1/2/target.jpg";
  const bucket = { list: async (folder, options) => {
    calls.push({ folder, options });
    return { error: null, data: [{ name: "target.jpg.backup" }] };
  } };
  await assert.doesNotReject(assertStorageObjectAbsent(bucket, path));
  assert.deepEqual(calls, [{ folder: "originals/2099-12/1/2", options: { limit: 100, search: "target.jpg" } }]);
  const invalid = [undefined, null, {}, { error: null, data: null }, { data: [] }, { error: "secret", data: [] },
    { error: null, data: [null] }, { error: null, data: new Array(1) }, { error: null, data: [{}] }, { error: null, data: [{ name: "nested/target.jpg" }] },
    { error: null, data: Array.from({ length: 100 }, (_, n) => ({ name: `other-${n}.jpg` })) },
    { error: null, data: [{ name: "target.jpg" }] }];
  for (const response of invalid) {
    await assert.rejects(assertStorageObjectAbsent({ list: async () => response }, path), (error) => {
      assert.doesNotMatch(error.message, /secret/); return true;
    });
  }
  for (const invalidPath of ["target.jpg", "/root/target.jpg", "root/../target.jpg", "root//target.jpg"]) {
    await assert.rejects(assertStorageObjectAbsent(bucket, invalidPath), /STORAGE_PATH_REJECTED/);
  }
  assert.equal(calls.length, 1, "invalid paths must not query Storage");
});
