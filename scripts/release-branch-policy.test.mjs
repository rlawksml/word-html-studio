import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkReleaseBranch } from "./release-branch-policy.mjs";

const route = (source, target, sourceRepo = "owner/studio", prNumber) =>
  checkReleaseBranch({ source, target, sourceRepo, targetRepo: "owner/studio", prNumber });

test("RELEASE-FLOW-01: accepts issue PRs into develop", () => {
  assert.equal(route("codex/v1.2-issue-123-save-draft", "develop"), "staging-source");
  assert.equal(route("codex/v1.2.1-task-release-docs", "develop"), "staging-source");
});

test("RELEASE-FLOW-02: accepts only the internal develop PR into main", () => {
  assert.equal(route("develop", "main"), "production-source");
  for (const branch of ["codex/m5-release-flow", "staging", "main"]) {
    assert.throws(() => route(branch, "main"), /develop → main/);
  }
});

test("RELEASE-FLOW-03: rejects forks, malformed refs and incomplete event data", () => {
  assert.throws(() => route("develop", "main", "other/studio"), /다른 저장소/);
  assert.throws(() => route("codex/v1.2-issue-123-save-draft", "develop", "other/studio"), /다른 저장소/);
  for (const branch of ["main", "staging", "codex/", "codex/m5-flow", "codex/v1.2-issue-0-save-draft", "codex/v1.2-save-draft"]) {
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

test("RELEASE-FLOW-06: allows only the existing v1.1 baseline PR to keep its legacy name", () => {
  const branch = "codex/m5-release-flow";
  assert.equal(route(branch, "develop", "owner/studio", 95), "staging-source");
  assert.throws(() => route(branch, "develop", "owner/studio", 96), /codex/);
  assert.throws(() => route(branch, "develop", "other/studio", 95), /다른 저장소/);
  assert.throws(() => route(branch, "main", "owner/studio", 95), /develop → main/);
});

test("RELEASE-FLOW-07: Markdown-only PRs skip the app gate while the required verify check still reports", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = (name) => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z-]+:\n/)[0] ?? "";
  assert.match(job("verify"), /needs: \[change-scope, verify-app\]/);
  assert.match(job("verify"), /if: always\(\) && /);
  assert.match(job("verify-app"), /if: needs\.change-scope\.outputs\.app == 'true' && /);
  assert.match(job("verify-app"), /- run: npm test/);
  assert.doesNotMatch(job("change-scope"), /actions\/checkout|secrets\.|npm /);
  assert.match(job("release-branch-policy"), /timeout-minutes: 5/);

  // Run the real scope script with a fake `gh` that prints the PR file list.
  const script = job("change-scope").split("        run: |\n")[1].replace(/^ {10}/gm, "");
  const { mkdtemp, writeFile, chmod, readFile: read } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const scope = async (eventName, files, ghFails = false) => {
    const dir = await mkdtemp(join(tmpdir(), "scope-"));
    await writeFile(join(dir, "gh"), ghFails ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\nprintf '%s\\n' ${files.map((file) => `'${file}'`).join(" ")}\n`);
    await chmod(join(dir, "gh"), 0o755);
    await writeFile(join(dir, "out"), "");
    execFileSync("bash", ["-e", "-c", script], { env: { PATH: `${dir}:${process.env.PATH}`, EVENT_NAME: eventName, REPOSITORY: "owner/studio", PR_NUMBER: "1", GITHUB_OUTPUT: join(dir, "out") }, stdio: "pipe" });
    return (await read(join(dir, "out"), "utf8")).trim();
  };
  assert.equal(await scope("pull_request", ["STATUS.md", "docs/RELEASE_FLOW.md"]), "app=false");
  assert.equal(await scope("pull_request", ["STATUS.md", "apps/web/lib/html-generators.ts"]), "app=true");
  assert.equal(await scope("pull_request", ["docs/guides/guide.pdf"]), "app=true");
  assert.equal(await scope("pull_request", ["NOTES.md", "apps/web/lib/old.ts"]), "app=true");
  assert.equal(await scope("pull_request", []), "app=true");
  assert.equal(await scope("pull_request", ["STATUS.md"], true), "app=true");
  assert.equal(await scope("push", ["STATUS.md"]), "app=true");
});
