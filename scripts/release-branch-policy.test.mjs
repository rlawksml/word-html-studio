import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkReleaseBranch } from "./release-branch-policy.mjs";

const route = (source, target, sourceRepo = "owner/studio") =>
  checkReleaseBranch({ source, target, sourceRepo, targetRepo: "owner/studio" });

test("RELEASE-FLOW-01: accepts issue PRs into develop", () => {
  assert.equal(route("codex/m5-release-flow", "develop"), "staging-source");
});

test("RELEASE-FLOW-02: accepts only the internal develop PR into main", () => {
  assert.equal(route("develop", "main"), "production-source");
  for (const branch of ["codex/m5-release-flow", "staging", "main"]) {
    assert.throws(() => route(branch, "main"), /develop → main/);
  }
});

test("RELEASE-FLOW-03: rejects forks, malformed refs and incomplete event data", () => {
  assert.throws(() => route("develop", "main", "other/studio"), /다른 저장소/);
  assert.throws(() => route("codex/m5-flow", "develop", "other/studio"), /다른 저장소/);
  for (const branch of ["main", "staging", "codex/", "codex/test/another"]) {
    assert.throws(() => route(branch, "develop"), /codex/);
  }
  assert.throws(() => checkReleaseBranch({}), /누락/);
});

test("RELEASE-FLOW-04: leaves optional feature stack PRs out of the release path", () => {
  assert.equal(route("codex/m5-test", "codex/m5-feature"), "feature-only");
});

test("RELEASE-FLOW-05: CI branch checks have no credentials, build or publish steps", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const policy = workflow.split("  release-branch-policy:\n")[1]?.split("\n  verify:")[0];
  assert.match(policy, /if: github.event_name == 'pull_request'/);
  assert.match(policy, /persist-credentials: false/);
  assert.match(policy, /node scripts\/release-branch-policy\.mjs/);
  assert.doesNotMatch(policy, /secrets\.|npm |upload|wrangler|supabase/i);
  assert.doesNotMatch(workflow, /npm run validate:deployment-target/);
  assert.match(workflow, /ready_for_review/);
  assert.match(workflow, /github.event.pull_request.draft == false/);
});
