import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBackupSource, assertIdleEditingLeases, captureStableBackupSource, readStorageInventory,
} from "../scripts/backup-source-guard.mjs";
import { tableSpecsForBackup } from "../scripts/supabase-schema.mjs";
import { sha256 } from "../scripts/backup-utils.mjs";

const SOURCE_URL = "https://backup-fixture.supabase.co";
const NOW_ISO = "2026-01-01T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const STALE = { resource_key: "fixture-only", expires_at: "2026-01-01T11:58:00.000Z", session_hash: "synthetic" };
const ACTIVE = { ...STALE, expires_at: "2026-01-01T12:01:00.000Z" };
const ORIGINAL = "bookstore-news-originals", PREVIEW = "bookstore-news-previews";
const bucket = (name) => ({ name, id: name, updated_at: NOW_ISO, public: name === PREVIEW });
const photo = (name, extra = {}) => ({
  name, id: `fixture-${name}`, updated_at: NOW_ISO, created_at: NOW_ISO,
  metadata: { size: 123, eTag: "opaque-fixture-etag" }, ...extra,
});

function mockStorage(buckets, resolve) {
  const calls = [];
  return { calls, storage: {
    async listBuckets() { return { error: null, data: structuredClone(buckets) }; },
    from(name) { return { async list(prefix, options) {
      calls.push([name, prefix, options.offset]);
      assert.deepEqual(options.sortBy, { column: "name", order: "asc" });
      assert.equal(options.limit, 100);
      return { error: null, data: resolve(name, prefix, options.offset) };
    } }; },
  } };
}

function harness({ initial = [], final = initial, changedRows, changedSchema, changedInventory } = {}) {
  const schema = { schemaVersionAvailable: false, digestOrderAvailable: false };
  const rows = {
    editing_leases: initial, bookstores: [{ id: 1 }],
    submissions: [{ id: 2, news: [{ title: "원본 📚", futureField: { untouched: true } }] }],
    improvement_requests: [],
  };
  const inventory = [{ name: ORIGINAL, objects: [{ path: "fixture.jpg", eTag: "old-tag" }] }];
  const reads = new Map(), events = [], archived = new Map();
  const next = (key) => { events.push(key); const n = (reads.get(key) || 0) + 1; reads.set(key, n); return n; };
  const operations = {
    async readSchema() { return structuredClone(next("schema") > 1 && changedSchema ? changedSchema : schema); },
    specsFor: ({ schemaVersionAvailable, digestOrderAvailable }) => tableSpecsForBackup(schemaVersionAvailable, digestOrderAvailable),
    async selectAll(table) {
      const pass = next(table);
      return structuredClone(pass === 1 ? rows[table] : table === "editing_leases" ? final : changedRows?.[table] ?? rows[table]);
    },
    async readInventory() { return structuredClone(next("inventory") > 1 && changedInventory ? changedInventory : inventory); },
    async captureTable(name, data, payload, digest) {
      assert.equal(sha256(payload), digest);
      archived.set(name, data);
      events.push(`archive-${name}`);
    },
    async captureStorage(actual) { assert.deepEqual(actual, inventory); events.push("archive-storage"); },
    now: () => NOW,
  };
  return { events, reads, archived, run: () => captureStableBackupSource(operations) };
}

test("BACKUP-SOURCE-01 only an exact approved HTTPS project root is accepted", () => {
  assert.equal(assertBackupSource(`${SOURCE_URL}/`, "backup-fixture", "confirmed"), SOURCE_URL);
  for (const url of [undefined, "http://backup-fixture.supabase.co", `${SOURCE_URL}:443`, `${SOURCE_URL}/path`,
    `${SOURCE_URL}?query=1`, `${SOURCE_URL}#fragment`, "https://key@backup-fixture.supabase.co", `${SOURCE_URL}.invalid`]) {
    assert.throws(() => assertBackupSource(url, "backup-fixture", "confirmed"), /^Error: BACKUP_SOURCE_URL_INVALID$/);
  }
});

test("BACKUP-SOURCE-02 unknown source or unconfirmed quiet window is rejected", () => {
  assert.throws(() => assertBackupSource(SOURCE_URL, "other-fixture", "confirmed"), /PROJECT_MISMATCH/);
  assert.throws(() => assertBackupSource(SOURCE_URL, undefined, "confirmed"), /PROJECT_MISMATCH/);
  for (const flag of [undefined, true, "yes"]) {
    assert.throws(() => assertBackupSource(SOURCE_URL, "backup-fixture", flag), /IDLE_WINDOW_CONFIRMATION_REQUIRED/);
  }
});

test("BACKUP-SOURCE-03 stale leases pass, active and clock-cushion leases block", () => {
  assert.doesNotThrow(() => assertIdleEditingLeases([STALE], NOW));
  assert.doesNotThrow(() => assertIdleEditingLeases([{ expires_at: "2026-01-01T11:58:00.123456+00:00" }], NOW));
  assert.doesNotThrow(() => assertIdleEditingLeases([{ expires_at: "2026-01-01T20:58:00.123456+09:00" }], NOW));
  assert.throws(() => assertIdleEditingLeases([ACTIVE], NOW), /ACTIVE_EDITING_LEASE/);
  assert.throws(() => assertIdleEditingLeases([{ expires_at: "2026-01-01T11:59:00.000Z" }], NOW), /ACTIVE_EDITING_LEASE/);
});

test("BACKUP-SOURCE-04 malformed lease data cannot be mistaken for idle", () => {
  for (const invalid of [null, [{ expires_at: null }], [{ expires_at: "2026-02-30T11:00:00Z" }],
    [{ expires_at: "2026-01-01T11:00:00" }]]) {
    assert.throws(() => assertIdleEditingLeases(invalid, NOW), /^Error: BACKUP_LEASE_STATE_INVALID$/);
  }
  assert.throws(() => assertIdleEditingLeases([], NaN), /LEASE_STATE_INVALID/);
});

test("BACKUP-SOURCE-05 active lease at start blocks before any payload or other read", async () => {
  const fake = harness({ initial: [ACTIVE] });
  await assert.rejects(fake.run(), /^Error: BACKUP_ACTIVE_EDITING_LEASE$/);
  assert.deepEqual(fake.events, ["editing_leases"]);
  assert.equal(fake.archived.size, 0);
});

test("BACKUP-SOURCE-06 stable source captures once and reads each scope exactly twice", async () => {
  const fake = harness({ initial: [STALE] });
  const specs = await fake.run();
  assert.equal(specs.length, 4);
  assert.equal(fake.archived.size, 4);
  assert.deepEqual(fake.archived.get("submissions")[0].news[0].futureField, { untouched: true });
  assert.deepEqual([...fake.reads.values()], [2, 2, 2, 2, 2, 2]);
  assert.equal(fake.events.at(-1), "editing_leases");
  assert.equal(fake.events.filter((value) => value === "archive-storage").length, 1);
});

test("BACKUP-SOURCE-07 same-count row changes abort on the exact payload hash", async () => {
  const fake = harness({ changedRows: { submissions: [{ id: 2, news: [{ title: "바뀜" }] }] } });
  await assert.rejects(fake.run(), /^Error: BACKUP_SOURCE_DATABASE_DRIFT$/);
  assert.equal(fake.archived.get("submissions")[0].news[0].title, "원본 📚");
});

test("BACKUP-SOURCE-08 schema capability drift aborts rather than changing inventory", async () => {
  await assert.rejects(harness({ changedSchema: { schemaVersionAvailable: true, digestOrderAvailable: true } }).run(),
    /^Error: BACKUP_SOURCE_SCHEMA_DRIFT$/);
});

test("BACKUP-SOURCE-09 same-name object eTag change and object additions/removals abort", async () => {
  for (const objects of [[], [{ path: "fixture.jpg", eTag: "replacement" }],
    [{ path: "fixture.jpg", eTag: "old-tag" }, { path: "added.jpg", eTag: "added-tag" }]]) {
    await assert.rejects(harness({ changedInventory: [{ name: ORIGINAL, objects }] }).run(), /^Error: BACKUP_SOURCE_STORAGE_DRIFT$/);
  }
});

test("BACKUP-SOURCE-10 active lease at finish aborts despite stable tables and storage", async () => {
  const fake = harness({ final: [ACTIVE] });
  await assert.rejects(fake.run(), /^Error: BACKUP_ACTIVE_EDITING_LEASE$/);
  assert.equal(fake.events.at(-1), "editing_leases");
});

test("BACKUP-SOURCE-11 changed but already expired lease still causes drift", async () => {
  await assert.rejects(harness({ initial: [STALE], final: [{ ...STALE, session_hash: "other-fixture" }] }).run(),
    /^Error: BACKUP_SOURCE_DATABASE_DRIFT$/);
});

test("BACKUP-SOURCE-12 recursive inventory ignores access time and has deterministic order", async () => {
  const make = (accessed) => mockStorage([bucket(PREVIEW), bucket(ORIGINAL)], (name, prefix) => name === PREVIEW ? []
    : prefix === "dir" ? [photo("nested.jpg", { last_accessed_at: accessed })]
      : [photo("z.jpg"), { name: "dir", id: null }, photo("a.jpg")]);
  const first = make("2026-01-01T12:00:00Z"), second = make("2026-01-01T12:00:05Z");
  const inventory = await readStorageInventory(first.storage);
  assert.deepEqual(inventory, await readStorageInventory(second.storage));
  assert.deepEqual(inventory[0].objects.map((object) => object.path), ["a.jpg", "dir/nested.jpg", "z.jpg"]);
  assert.deepEqual(first.calls, [[ORIGINAL, "", 0], [ORIGINAL, "dir", 0], [PREVIEW, "", 0]]);
});

test("BACKUP-SOURCE-13 missing/private-policy buckets and malformed inventory fail closed", async () => {
  for (const buckets of [[bucket(ORIGINAL)], [{ ...bucket(ORIGINAL), public: true }, bucket(PREVIEW)],
    [bucket(ORIGINAL), bucket(PREVIEW), bucket("bookstore-news-extra")]]) {
    await assert.rejects(readStorageInventory(mockStorage(buckets, () => []).storage), /INVENTORY_INVALID/);
  }
  for (const entries of [[photo("../escape")], [photo("bad-tag.jpg", { metadata: { size: 123 } })],
    [photo("%2e%2e")], [photo("hash#fragment.jpg")],
    [photo("large.jpg", { metadata: { size: 64 * 1024 * 1024 + 1, eTag: "opaque" } })],
    [photo("same.jpg"), photo("same.jpg")]]) {
    await assert.rejects(readStorageInventory(mockStorage([bucket(ORIGINAL), bucket(PREVIEW)], () => entries).storage), /INVENTORY_INVALID/);
  }
});

test("BACKUP-SOURCE-14 storage pagination detects repeated entries and redacts SDK errors", async () => {
  const generated = Array.from({ length: 100 }, (_, i) => photo(`fixture-${i}.jpg`));
  const duplicated = mockStorage([bucket(ORIGINAL), bucket(PREVIEW)], () => generated);
  await assert.rejects(readStorageInventory(duplicated.storage), /^Error: BACKUP_STORAGE_INVENTORY_INVALID$/);
  assert.deepEqual(duplicated.calls, [[ORIGINAL, "", 0], [ORIGINAL, "", 100]]);
  for (const listBuckets of [async () => { throw new Error("PRIVATE_FIXTURE_PATH"); },
    async () => ({ error: { message: "PRIVATE_FIXTURE_PATH" } }), async () => ({ data: null, error: null })]) {
    await assert.rejects(readStorageInventory({ listBuckets }), /^Error: BACKUP_STORAGE_LIST_FAILED$/);
  }
});
