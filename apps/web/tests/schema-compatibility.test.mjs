import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  mergeNewsPreservingUnknownFields,
} from "../lib/submission-json-compatibility.ts";
import {
  findForbiddenMigrationStatements,
  validateMigrationChanges,
  validateMigrationDirectory,
} from "../scripts/migration-policy.mjs";
import {
  APP_PRODUCT_VERSION,
  APP_SCHEMA_VERSION,
} from "../lib/release-version.ts";
import {
  isMissingTableError,
  tableSpecsForBackup,
  tableSpecsForRestore,
} from "../scripts/supabase-schema.mjs";

function knownNews(overrides = {}) {
  return {
    id: 101,
    title: "기존 앱에서 수정한 제목",
    description: "기존 필드 수정",
    dates: ["2026-09-10"],
    scheduleText: "",
    regular: false,
    displayLabel: "",
    deadline: "",
    place: "",
    fee: "",
    applicationInfo: "",
    applyUrl: "",
    extraFields: [{ id: 201, label: "대상", value: "누구나" }],
    links: [{ id: 301, label: "안내", url: "https://example.com" }],
    images: [{
      id: 401,
      name: "poster.jpg",
      originalPath: "originals/poster.jpg",
      previewPath: "previews/poster.jpg",
      caption: "수정된 설명",
    }],
    includeInDigest: true,
    ...overrides,
  };
}

test("롤백된 v1.0.1 저장은 자신이 모르는 v1.1 JSON 필드와 중첩 필드를 보존한다", () => {
  const existing = [{
    ...knownNews({ title: "v1.1 제목" }),
    scheduleRangeRef: "range-101",
    futureOptions: { calendarMode: "range", color: "amber" },
    extraFields: [{ id: 201, label: "대상", value: "누구나", futureFormat: "chip" }],
    links: [{ id: 301, label: "안내", url: "https://example.com", futureTracking: "campaign" }],
    images: [{
      ...knownNews().images[0],
      caption: "기존 설명",
      futureAltText: "접근성 설명",
    }],
  }];
  const requestedByOldApp = [knownNews()];

  const merged = mergeNewsPreservingUnknownFields(existing, requestedByOldApp);

  assert.equal(merged[0].title, "기존 앱에서 수정한 제목");
  assert.equal(merged[0].scheduleRangeRef, "range-101");
  assert.deepEqual(merged[0].futureOptions, { calendarMode: "range", color: "amber" });
  assert.equal(merged[0].extraFields[0].futureFormat, "chip");
  assert.equal(merged[0].links[0].futureTracking, "campaign");
  assert.equal(merged[0].images[0].futureAltText, "접근성 설명");
  assert.equal(merged[0].images[0].caption, "수정된 설명");
});

test("삭제된 소식과 사진은 되살리지 않고 요청 순서를 유지한다", () => {
  const existing = [
    { ...knownNews({ id: 1 }), futureValue: "첫째" },
    { ...knownNews({ id: 2 }), futureValue: "둘째" },
  ];
  const requested = [
    knownNews({ id: 2, images: [] }),
    knownNews({ id: 3, images: [] }),
  ];

  const merged = mergeNewsPreservingUnknownFields(existing, requested);

  assert.deepEqual(merged.map((item) => item.id), [2, 3]);
  assert.equal(merged[0].futureValue, "둘째");
  assert.equal(merged[1].futureValue, undefined);
  assert.deepEqual(merged[0].images, []);
});

test("새 migration의 파괴적 SQL은 차단하고 additive SQL은 허용한다", () => {
  assert.deepEqual(findForbiddenMigrationStatements(`
    create table public.safe_table (id bigint primary key);
    alter table public.safe_table add column if not exists label text;
  `), []);

  const forbidden = findForbiddenMigrationStatements(`
    drop table public.bookstores;
    alter table public.submissions drop column news;
    truncate table public.submissions;
    delete from public.submissions;
    alter table public.bookstores rename column name to title;
    alter table public.bookstores alter column id type text;
  `);
  assert.deepEqual(forbidden.map((item) => item.rule), [
    "DROP_TABLE",
    "DROP_COLUMN",
    "TRUNCATE",
    "DELETE_FROM",
    "RENAME_COLUMN",
    "ALTER_COLUMN_TYPE",
  ]);
  assert.deepEqual(validateMigrationChanges("A\tapps/web/supabase/migrations/202609070002_new.sql\n"), []);
  assert.equal(validateMigrationChanges("M\tapps/web/supabase/migrations/202607210001_initial_workspace.sql\n").length, 1);
  assert.equal(validateMigrationChanges("D\tapps/web/supabase/migrations/202607220001_secure_media_and_flexible_fields.sql\n").length, 1);
});

test("이전 백업은 기존 테이블만, 새 백업은 호환 테이블까지 안전한 순서로 다룬다", () => {
  assert.equal(isMissingTableError({ code: "PGRST205" }), true);
  assert.equal(isMissingTableError({ code: "42P01" }), true);
  assert.equal(isMissingTableError({ code: "PGRST303" }), false);
  assert.deepEqual(
    tableSpecsForBackup(false).map((table) => table.name),
    ["bookstores", "submissions", "editing_leases", "improvement_requests"],
  );
  assert.deepEqual(
    tableSpecsForBackup(true).map((table) => table.name),
    ["bookstores", "submissions", "editing_leases", "improvement_requests", "app_schema_versions", "news_schedule_ranges"],
  );
  assert.deepEqual(
    tableSpecsForRestore({ bookstores: {}, submissions: {} }).map((table) => table.name),
    ["bookstores", "submissions"],
  );
  assert.throws(() => tableSpecsForRestore({ unknown_table: {} }), /unsupported tables/);
});

test("migration manifest와 스키마 기반 migration이 일치한다", async () => {
  const result = await validateMigrationDirectory(new URL("../supabase/migrations/", import.meta.url));
  assert.equal(result.status, "PASS", result.failures.join("\n"));
  assert.equal(APP_PRODUCT_VERSION, "1.1.0-rc.1");
  assert.equal(APP_SCHEMA_VERSION, 202609070002);

  const migration = await readFile(
    new URL("../supabase/migrations/202609070001_rollback_compatibility_foundation.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table if not exists public\.app_schema_versions/);
  assert.match(migration, /create table if not exists public\.news_schedule_ranges/);
  assert.match(migration, /check \(end_date >= start_date\)/);

  const rangeMigration = await readFile(
    new URL("../supabase/migrations/202609070002_schedule_range_persistence.sql", import.meta.url),
    "utf8",
  );
  assert.match(rangeMigration, /add column if not exists is_active/);
  assert.match(rangeMigration, /save_submission_with_schedule_ranges/);
  assert.match(rangeMigration, /p_sync_ranges/);
  assert.doesNotMatch(rangeMigration, /delete\s+from/i);
});

test("Submission API가 서버의 기존 JSON을 호환 병합한다", async () => {
  const route = await readFile(new URL("../app/api/submissions/route.ts", import.meta.url), "utf8");
  assert.match(route, /mergeNewsPreservingUnknownFields/);
  assert.match(route, /existing\?\.news/);
  assert.match(route, /save_submission_with_schedule_ranges/);
  assert.match(route, /rangeWasSent/);
});
