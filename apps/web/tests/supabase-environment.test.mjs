import assert from "node:assert/strict";
import test from "node:test";
import { assertSupabaseRuntimeTarget } from "../lib/supabase-environment.mjs";
import { assertIntegrationTarget } from "./helpers/integration-target-guard.mjs";

const stagingUrl = "https://staging-ref.supabase.co";

test("integration target guard accepts only explicitly isolated Staging", () => {
  const valid = {
    APP_ENV: "staging",
    SUPABASE_URL: "https://kriyjyyudngtibrtkylf.supabase.co",
    EXPECTED_SUPABASE_PROJECT_REF: "kriyjyyudngtibrtkylf",
    BLOCKED_SUPABASE_PROJECT_REFS: "kdigttaghqubfjsmbngl",
  };
  assert.doesNotThrow(() => assertIntegrationTarget(valid));
  assert.doesNotThrow(() => assertIntegrationTarget({ ...valid, SUPABASE_URL: valid.SUPABASE_URL + "/" }));
  const invalid = [
    { APP_ENV: undefined }, { APP_ENV: "production" },
    { EXPECTED_SUPABASE_PROJECT_REF: "other" },
    { BLOCKED_SUPABASE_PROJECT_REFS: "" },
    { BLOCKED_SUPABASE_PROJECT_REFS: "kdigttaghqubfjsmbngl,kriyjyyudngtibrtkylf" },
    ...["", "https://kdigttaghqubfjsmbngl.supabase.co", "https://other.supabase.co",
      "http://kriyjyyudngtibrtkylf.supabase.co", "https://user:secret@kriyjyyudngtibrtkylf.supabase.co",
      valid.SUPABASE_URL + ":443", valid.SUPABASE_URL + "/rest/v1", valid.SUPABASE_URL + "?token=secret",
      valid.SUPABASE_URL + "#fragment", " " + valid.SUPABASE_URL,
    ].map((SUPABASE_URL) => ({ SUPABASE_URL })),
  ];
  for (const override of invalid) assert.throws(() => assertIntegrationTarget({ ...valid, ...override }));
});

test("staging accepts only its expected non-production Supabase project", () => {
  assert.equal(assertSupabaseRuntimeTarget({
    appEnv: "staging",
    supabaseUrl: stagingUrl,
    expectedProjectRef: "staging-ref",
    blockedProjectRefs: "production-ref",
  }), "staging-ref");
  assert.throws(() => assertSupabaseRuntimeTarget({
    appEnv: "staging",
    supabaseUrl: stagingUrl,
    expectedProjectRef: "another-ref",
    blockedProjectRefs: "production-ref",
  }), /예상값과 다릅니다/);
  assert.throws(() => assertSupabaseRuntimeTarget({
    appEnv: "staging",
    supabaseUrl: stagingUrl,
    expectedProjectRef: "staging-ref",
    blockedProjectRefs: "",
  }), /차단 목록이 비어/);
  assert.throws(() => assertSupabaseRuntimeTarget({
    appEnv: "staging",
    supabaseUrl: stagingUrl,
    expectedProjectRef: "staging-ref",
    blockedProjectRefs: "staging-ref,production-ref",
  }), /운영 Supabase 연결을 거부/);
});

test("production remains compatible before the optional guard variables are added", () => {
  assert.equal(assertSupabaseRuntimeTarget({
    appEnv: "production",
    supabaseUrl: "https://production-ref.supabase.co",
  }), "production-ref");
});
