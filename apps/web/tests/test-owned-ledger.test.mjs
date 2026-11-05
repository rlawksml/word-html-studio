import assert from "node:assert/strict";
import test from "node:test";
import { canonical, createTestOwnedLedger, qaMarker } from "./helpers/test-owned-ledger.mjs";

const runId = "retain-run";
const spec = { table: "bookstores", id: 101, parentId: null, month: null };
const requested = () => ({ id: 101, name: `${qaMarker(runId)} sample`, unknown: { future: [1, 2] } });
const row = (revision = "2026-11-01T00:00:01.000Z") => ({ ...requested(), updated_at: revision });
const response = (data, status = 201) => ({ error: null, status, data: [data] });

test("ledger transitions intent→confirmed create→pending CAS→confirmed update with immutable receipts", () => {
  const ledger = createTestOwnedLedger(runId);
  const input = requested();
  const handle = ledger.intent(spec, input);
  input.unknown.future.push(99);
  assert.equal(ledger.record(handle).state, "intent");
  const first = ledger.confirmCreate(handle, response(row()));
  assert.ok(Object.isFrozen(first.unknown.future));
  assert.deepEqual(first.unknown.future, [1, 2]);
  const next = { ...first, name: `${qaMarker(runId)} updated` };
  const pending = ledger.beginCAS(handle, next);
  assert.equal(ledger.record(handle).state, "pendingCAS");
  assert.equal(pending.before.updated_at, first.updated_at);
  const updated = ledger.confirmUpdate(handle, response({ ...next, updated_at: "2026-11-01T00:00:02.000Z" }, 200));
  const record = ledger.record(handle);
  assert.equal(record.state, "confirmed");
  assert.equal(record.updates.length, 1);
  assert.deepEqual(record.updates[0].before, first);
  assert.deepEqual(record.latest, updated);
  assert.throws(() => { record.latest.unknown.future.push(3); }, TypeError);
});

test("failed, missing, lost and unknown create acknowledgements are terminal uncertain", () => {
  for (const result of [undefined, {}, { status: 201, error: null, data: null },
    { status: 201, error: null, data: [] }, { status: 204, error: null, data: [row()] },
    { status: 201, error: { message: "secret" }, data: [row()] }, response({ ...row(), name: "no marker" }),
    response({ ...row(), id: 102 })]) {
    const ledger = createTestOwnedLedger(runId);
    const handle = ledger.intent(spec, requested());
    assert.throws(() => ledger.confirmCreate(handle, result), /LEDGER_CREATE_UNCERTAIN/);
    assert.equal(ledger.record(handle).state, "uncertain");
    assert.equal(ledger.record(handle).latest, null);
    assert.throws(() => ledger.confirmCreate(handle, response(row())), /LEDGER_TRANSITION_REJECTED/);
  }
});

test("CAS conflict/response loss/unchanged revision cannot advance last acknowledged revision", () => {
  for (const result of [undefined, { error: null, status: 200, data: [] },
    { error: { message: "conflict" }, status: 409, data: null }, response(row(), 200),
    response({ ...row("2026-11-01T00:00:02.000Z"), unknown: { deleted: "field" } }, 200)]) {
    const ledger = createTestOwnedLedger(runId);
    const handle = ledger.intent(spec, requested());
    const before = ledger.confirmCreate(handle, response(row()));
    ledger.beginCAS(handle, before);
    assert.throws(() => ledger.confirmUpdate(handle, result), /LEDGER_UPDATE_UNCERTAIN/);
    assert.equal(ledger.record(handle).state, "uncertain");
    assert.equal(ledger.record(handle).latest.updated_at, before.updated_at);
    assert.equal(ledger.record(handle).updates.length, 0);
    assert.throws(() => ledger.beginCAS(handle, before), /LEDGER_TRANSITION_REJECTED/);
  }
});

test("markUncertain cannot be promoted by re-observation or an apparent successful response", () => {
  const ledger = createTestOwnedLedger(runId);
  const handle = ledger.intent(spec, requested());
  ledger.confirmCreate(handle, response(row()));
  ledger.markUncertain(handle);
  assert.throws(() => ledger.confirmUpdate(handle, response(row(), 200)), /LEDGER_TRANSITION_REJECTED/);
  assert.equal(ledger.record(handle).state, "uncertain");
});

test("five news items remain one submission row; month/parent/marker and unsupported identities are rejected", () => {
  const subSpec = { table: "submissions", id: 102, parentId: 101, month: "2026-11" };
  const submission = { id: 102, bookstore_id: 101, month: "2026-11", monthly_notice: qaMarker(runId),
    news: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, title: `news ${index + 1}` })) };
  const ledger = createTestOwnedLedger(runId);
  const handle = ledger.intent(subSpec, submission);
  const confirmed = ledger.confirmCreate(handle, response({ ...submission, updated_at: row().updated_at }));
  assert.equal(confirmed.news.length, 5);
  for (const patch of [{ bookstore_id: 999 }, { month: "2026-06" }, { monthly_notice: "no marker" }, { news: [] }]) {
    const l = createTestOwnedLedger(runId);
    assert.throws(() => l.intent(subSpec, { ...submission, ...patch }), /LEDGER_/);
  }
  for (const table of ["news_schedule_ranges", "editing_leases", "improvement_requests", "monthly_digests", "storage"]) {
    assert.throws(() => createTestOwnedLedger(runId).intent({ ...spec, table }, requested()), /LEDGER_UNSUPPORTED_TARGET/);
  }
  assert.throws(() => createTestOwnedLedger(runId).intent({ ...spec, id: "composite:1:2" }, requested()), /LEDGER_UNSUPPORTED_TARGET/);
});

test("canonical full rows preserve unknown fields and reject non-JSON values", () => {
  assert.equal(canonical({ z: [1], a: { unknown: false } }), canonical({ a: { unknown: false }, z: [1] }));
  for (const value of [undefined, NaN, () => true, new Date()]) assert.throws(() => canonical(value), /LEDGER_NON_JSON_VALUE/);
});
