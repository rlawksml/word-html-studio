import assert from "node:assert/strict";
import test from "node:test";
import { assertSupabaseRuntimeTarget } from "../lib/supabase-environment.mjs";

const stagingUrl = "https://staging-ref.supabase.co";

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
