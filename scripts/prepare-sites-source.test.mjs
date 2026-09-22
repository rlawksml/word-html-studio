import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareSitesSource } from "./prepare-sites-source.mjs";

async function fixture(t, project = "appgprj_6a9e5e7aea3c8191a70eae751c212394") {
  const root = await mkdtemp(path.join(tmpdir(), "sites-adapter-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  await mkdir(path.join(root, "apps/web/.openai"), { recursive: true });
  await writeFile(path.join(root, "apps/web/.openai/hosting.json"), JSON.stringify({ project_id: project }));
  await writeFile(path.join(root, "apps/web/app.txt"), "committed\n");
  const commit = () => { git("add", "."); git("commit", "-m", "fixture"); };
  commit();
  return { root, commit, git };
}

test("exports committed bytes only with provenance, leaving dirty and untracked input intact", async (t) => {
  const { root, git } = await fixture(t);
  await writeFile(path.join(root, "apps/web/app.txt"), "unsaved\n");
  await writeFile(path.join(root, "apps/web/.env.local"), "TEST_ONLY=not-exported");
  const before = git("status", "--porcelain").toString();
  const result = await prepareSitesSource(root, "HEAD");
  t.after(() => rm(result.destination, { recursive: true, force: true }));
  assert.equal(await readFile(path.join(result.destination, "app.txt"), "utf8"), "committed\n");
  await assert.rejects(readFile(path.join(result.destination, ".env.local")), { code: "ENOENT" });
  const provenance = JSON.parse(await readFile(path.join(result.destination, "deployment-provenance.json")));
  assert.equal(provenance.sourceCommit, git("rev-parse", "HEAD").toString().trim());
  assert.equal(provenance.files.length, 2);
  assert.equal(git("status", "--porcelain").toString(), before);
  assert.equal(result.deployed, false);
});
test("rejects production destination", async (t) => {
  const { root } = await fixture(t, "appgprj_6a5dbe2598fc8191a1c25c37e759c6ae");
  await assert.rejects(prepareSitesSource(root, "HEAD"), /Only.*Staging/);
});
test("rejects tracked env files", async (t) => {
  const { root, commit } = await fixture(t);
  await writeFile(path.join(root, "apps/web/.env.local"), "TEST_ONLY=fixture"); commit();
  await assert.rejects(prepareSitesSource(root, "HEAD"), /Sensitive/);
});
test("rejects symlinks before export", async (t) => {
  const { root, commit } = await fixture(t);
  await symlink("app.txt", path.join(root, "apps/web/link")); commit();
  await assert.rejects(prepareSitesSource(root, "HEAD"), /Symlinks/);
});
