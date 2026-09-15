import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/production-supabase-keepalive.yml", import.meta.url);

test("Production Supabase keepalive is scheduled and read-only", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /cron: "17 \*\/8 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /https:\/\/bookstore-news-studio\.rlawksml\.chatgpt\.site\/api\/workspace/);
  assert.match(workflow, /--output \/dev\/null/);
  assert.match(workflow, /--retry 3/);
  assert.match(workflow, /--max-time 30/);

  assert.doesNotMatch(workflow, /SUPABASE_(?:SECRET|SERVICE_ROLE|ANON)_KEY/);
  assert.doesNotMatch(workflow, /\bcurl\b[^\n]*(?:-X|--request)\s+(?:POST|PUT|PATCH|DELETE)\b/i);
  assert.doesNotMatch(workflow, /\b(?:POST|PUT|PATCH|DELETE)\b\s+https?:\/\//i);
});
