import assert from "node:assert/strict";
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
