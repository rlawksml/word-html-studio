// Probe the EXACT historical parser, not a patched compatibility helper.
// Four preservation assertions are expected to be RED if fields are lost.
// No DB/API/SDK, environment file, real data, or deployed endpoint is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const EXACT = Object.freeze({
  "workspace-validation.ts.txt": "b2e4b56c828a619c75f067ffb0936c935cd64eca8a6bec786db08044e1185ca4",
  "workspace-records.ts.txt": "83ef4154f7e9d00937cd33a67e358ee3726e3267cc4ea871a20449cb10c2c9f3",
  "submission-route.ts.txt": "0f455779ab1f5fa0c2e85445b5d0928e5b113113bf3f13b412090a2b923bc831",
});
const fixtureUrl = (name) => new URL(`./fixtures/exact-fallback-28efad2/${name}`, import.meta.url);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function exactBytes(name) {
  assert.ok(Object.hasOwn(EXACT, name));
  const bytes = await readFile(fixtureUrl(name));
  assert.equal(digest(bytes), EXACT[name]);
  return bytes;
}

async function withExactParser(run) {
  const bytes = await exactBytes("workspace-validation.ts.txt");
  const root = await mkdtemp(path.join(os.tmpdir(), "bookstore-exact-fallback-owned-"));
  try {
    // Native TS stripping erases the historical type-only import. There are
    // no runtime imports in this exact module and no transpiler/install step.
    await writeFile(path.join(root, "package.json"), '{"type":"module"}\n', { flag: "wx" });
    const target = path.join(root, "workspace-validation.ts");
    await writeFile(target, bytes, { flag: "wx", mode: 0o400 });
    const { parseSubmission } = await import(pathToFileURL(target).href);
    assert.equal(typeof parseSubmission, "function");
    await run(parseSubmission);
  } finally {
    // Only this invocation's newly created synthetic scratch root is removed.
    await rm(root, { recursive: true, force: true });
  }
}

function submission() {
  return {
    id: 1, bookstoreId: 1, month: "2026-06", status: "draft", updatedAt: "",
    completedAt: "", publishedAt: "", publishedUrl: "", monthlyNotice: "QA only",
    news: [{
      id: 1, title: "신규모집 📚", description: "첫째 줄\n둘째 줄", dates: ["2026-06-17"],
      regular: false, includeInDigest: true, scheduleText: "", displayLabel: "",
      deadline: "", place: "QA", fee: "", applicationInfo: "", applyUrl: "",
      images: [{ id: 1, name: "QA.jpg", caption: "", originalPath: "originals/qa.jpg", previewPath: "previews/qa.jpg" }],
      extraFields: [{ id: 1, label: "QA", value: "synthetic" }],
      links: [{ id: 1, label: "QA", url: "https://example.invalid/qa" }],
    }],
  };
}

test("FALLBACK-EXACT-01 original public source hashes and save-path trace match", async () => {
  for (const name of Object.keys(EXACT)) await exactBytes(name);
  const route = (await exactBytes("submission-route.ts.txt")).toString("utf8");
  assert.match(route, /const submission = parseSubmission\(body\.submission\)/);
  assert.match(route, /news: sanitizeNews\(next\.news\)/);
  assert.match(route, /\.update\(values\)/);
  assert.doesNotMatch(route, /mergeNewsPreservingUnknownFields/);
});

test("FALLBACK-EXACT-02 known values parse and caller input stays unchanged", async () => {
  await withExactParser((parse) => {
    const value = submission(), before = JSON.stringify(value);
    const result = parse(value);
    assert.equal(result.news[0].title, value.news[0].title);
    assert.equal(result.news[0].description, value.news[0].description);
    assert.equal(result.news[0].images[0].originalPath, "originals/qa.jpg");
    assert.equal(JSON.stringify(value), before);
  });
});

for (const [number, field, select] of [
  [3, "futureNews", (value) => value.news[0]],
  [4, "futureImage", (value) => value.news[0].images[0]],
  [5, "futureExtra", (value) => value.news[0].extraFields[0]],
  [6, "futureLink", (value) => value.news[0].links[0]],
]) {
  test(`FALLBACK-EXACT-0${number} fallback must preserve ${field}`, async () => {
    await withExactParser((parse) => {
      const value = submission();
      select(value)[field] = { preserve: "opaque synthetic future value" };
      const before = JSON.stringify(value);
      const parsed = parse(value);
      assert.deepEqual(select(parsed)[field], select(value)[field]);
      assert.equal(JSON.stringify(value), before);
    });
  });
}
