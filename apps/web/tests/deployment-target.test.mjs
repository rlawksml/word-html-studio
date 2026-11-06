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

test("blocks high-severity production dependency advisories in CI", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.scripts["audit:production"], "npm audit --omit=dev --audit-level=high");
  assert.match(workflow, /- run: npm run audit:production/);
  // RSC는 dev로 분류돼 production audit에서 빠질 수 있으므로 세 패키지의
  // 공식 보안 patch 버전과 lock/SRI를 별도로 고정한다. 앱 악용 재현은 아니다.
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const integrity = {
    react: "sha512-RuLdAokXv3sRmZa2/N8QH0KmTBIgDKC+buRUikGqow31+mGSGidLCX2o4XFq8OV+xBFWfhM9DVgTq1PPHADH4w==",
    "react-dom": "sha512-YceU74W21fXEHszKBLj16MY0CmvpFKOs60iVrIyW/cCgOPsZJNaB6GVJEtIUqt6AG6EjzKLui5lPRrxAeS328Q==",
    "react-server-dom-webpack": "sha512-7vhLc+COcttZsIsZa5qbT4Qn3Flp2fCadhuGRKpwE3ahmbu21hOnPFKwziNHZj8Fqtfcbs7pTJV69QA5GcUpbw==",
  };
  for (const [name, expectedIntegrity] of Object.entries(integrity)) {
    const field = name === "react-server-dom-webpack" ? "devDependencies" : "dependencies";
    assert.equal(packageJson[field][name], "19.2.9");
    assert.equal(lock.packages[""][field][name], "19.2.9");
    const item = lock.packages[`node_modules/${name}`];
    assert.equal(item.version, "19.2.9");
    assert.equal(item.resolved, `https://registry.npmjs.org/${name}/-/${name}-19.2.9.tgz`);
    assert.equal(item.integrity, expectedIntegrity);
    if (name !== "react") assert.equal(item.peerDependencies.react, "^19.2.9");
    if (name === "react-server-dom-webpack") assert.equal(item.peerDependencies["react-dom"], "^19.2.9");
  }
});

test("pins Cloudflare build tooling beyond the audited vulnerable ranges", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  // 세 도구는 함께 호환되는 버전으로 고정해야 Vite plugin과 Wrangler가 서로 다른 Miniflare를 끌어오지 않습니다.
  assert.equal(packageJson.devDependencies["@cloudflare/vite-plugin"], "1.63.1");
  assert.equal(packageJson.devDependencies.vite, "8.2.4");
  assert.equal(packageJson.devDependencies.wrangler, "4.149.0");
  assert.deepEqual(packageJson.overrides, {
    "undici@7.29.1": "7.30.1", "zod@4.4.3": "4.6.6",
    "brace-expansion@1.1.18": "1.1.21", "brace-expansion@5.0.9": "5.0.12",
  });
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const versions = {
    vinext: "1.2.0", "@vitejs/plugin-rsc": "0.5.37",
    "@cloudflare/workers-types": "5.20261006.1",
    vite: "8.2.4", miniflare: "5.20261006.1-alpha", workerd: "1.20261006.1", sharp: "0.35.5",
    undici: "7.30.1", zod: "4.6.6", "brace-expansion": "1.1.21",
    "@typescript-eslint/typescript-estree/node_modules/brace-expansion": "5.0.12",
  };
  for (const [name, version] of Object.entries(versions)) {
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    if (Object.hasOwn(packageJson.devDependencies, name)) assert.equal(packageJson.devDependencies[name], version);
  }
  // lock에서 빠진 image-size를 vinext 내부 bundle의 수정 증거로 삼지 않는다.
  for (const [path, item] of Object.entries(lock.packages)) {
    if (/(?:^|\/)node_modules\/sharp$/.test(path)) assert.equal(item.version, "0.35.5");
    if (/(?:^|\/)node_modules\/miniflare$/.test(path)) assert.equal(item.version, "5.20261006.1-alpha");
  }
});
