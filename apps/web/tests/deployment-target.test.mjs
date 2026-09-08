import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SITE_PROJECT_IDS,
  assertHostingProjectForTarget,
  normalizeDeploymentTarget,
} from "../scripts/deployment-target-policy.mjs";

test("maps Git branches to their isolated Sites projects", () => {
  assert.equal(normalizeDeploymentTarget("main"), "production");
  assert.equal(normalizeDeploymentTarget("develop"), "staging");
  assert.equal(normalizeDeploymentTarget("codex/v1.1-calendar-date-confirm"), "staging");
  assert.equal(assertHostingProjectForTarget({
    target: "develop",
    projectId: SITE_PROJECT_IDS.staging,
  }), "staging");
  assert.equal(assertHostingProjectForTarget({
    target: "main",
    projectId: SITE_PROJECT_IDS.production,
  }), "production");
  assert.equal(assertHostingProjectForTarget({
    target: "codex/v1.1-calendar-date-confirm",
    projectId: SITE_PROJECT_IDS.staging,
  }), "staging");
});

test("rejects staging and production Sites project cross-wiring", () => {
  assert.throws(() => assertHostingProjectForTarget({
    target: "main",
    projectId: SITE_PROJECT_IDS.staging,
  }), /일치하지 않습니다/);
  assert.throws(() => assertHostingProjectForTarget({
    target: "develop",
    projectId: SITE_PROJECT_IDS.production,
  }), /일치하지 않습니다/);
  assert.throws(() => assertHostingProjectForTarget({
    target: "codex/v1.1-calendar-date-confirm",
    projectId: SITE_PROJECT_IDS.production,
  }), /일치하지 않습니다/);
  assert.throws(() => assertHostingProjectForTarget({
    target: "feature",
    projectId: SITE_PROJECT_IDS.staging,
  }), /알 수 없는 배포 대상/);
});

test("uses GitHub Actions releases backed by the supported Node 24 runtime", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

  // 두 job이 같은 런타임 세대를 사용해야 한쪽 검증만 경고 없이 통과하는 상태를 막을 수 있습니다.
  assert.equal((workflow.match(/actions\/checkout@v7/g) ?? []).length, 2);
  assert.equal((workflow.match(/actions\/setup-node@v7/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v[1-4]\b/);
});
