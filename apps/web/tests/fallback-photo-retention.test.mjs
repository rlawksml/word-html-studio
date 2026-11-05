// Actual old route/client with fixed native dependencies only. No SDK, keys,
// network, DB, Storage objects, deployed artifact, or real session is used.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { deleteStoredImages } from "../lib/workspace-client.ts";

const routeUrl = new URL("../app/api/images/route.ts", import.meta.url);
const stubUrl = "bookstore-fallback-photo:fixed-dependencies";
const routeImports = new Set(["next/server", "@/lib/supabase-server", "@/lib/workspace-session"]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if ((context.parentURL === routeUrl.href && routeImports.has(specifier))
      || (context.parentURL === import.meta.url && specifier === stubUrl)) {
      return { url: stubUrl, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === stubUrl) return {
      format: "module",
      shortCircuit: true,
      source: `
        let role = "input";
        const counts = { session: 0, cloud: 0 };
        export function reset(value = "input") { role = value; counts.session = 0; counts.cloud = 0; }
        export function observed() { return { ...counts }; }
        export class NextRequest extends Request {}
        export class NextResponse extends Response {
          static json(value, options) { return Response.json(value, options); }
        }
        export class SupabaseConfigurationError extends Error {}
        export const ORIGINAL_IMAGE_BUCKET = "synthetic-originals";
        export const PREVIEW_IMAGE_BUCKET = "synthetic-previews";
        export async function readWorkerSession() { counts.session++; return role; }
        export function getSupabaseAdmin() { counts.cloud++; throw new Error("CLOUD_ACCESS_FORBIDDEN"); }
        export function retryFutureJwt() { counts.cloud++; throw new Error("CLOUD_ACCESS_FORBIDDEN"); }
      `,
    };
    return next(url, context);
  },
});
let dependencies, deleteImages;
try {
  dependencies = await import(stubUrl);
  ({ DELETE: deleteImages } = await import(routeUrl.href));
} finally {
  hooks.deregister();
}

const retained = { retained: true, deleted: false, code: "IMAGE_CLEANUP_DEFERRED" };
const image = () => ({ originalPath: "originals/synthetic/photo.jpg", previewPath: "previews/synthetic/photo.jpg" });
const requestBody = (body) => new Request("https://fallback-photo.fixture.invalid/api/images", {
  method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const assertNoCloud = () => assert.equal(dependencies.observed().cloud, 0, "no SDK/Storage access is permitted");

test("FALLBACK-PHOTO-01 actual DELETE acknowledges retention without changing the request", async () => {
  dependencies.reset();
  const body = { images: [image()] }, before = JSON.stringify(body);
  const response = await deleteImages(requestBody(body));
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), retained);
  assert.equal(JSON.stringify(body), before);
  assert.equal(dependencies.observed().session, 1);
  assertNoCloud();
});

test("FALLBACK-PHOTO-02 absent or HTML session is rejected before reading the body", async () => {
  for (const role of [null, "html"]) {
    dependencies.reset(role);
    let bodyReads = 0;
    const response = await deleteImages({ json: async () => { bodyReads++; throw new Error("BODY_MUST_NOT_BE_READ"); } });
    assert.equal(response.status, 403);
    assert.equal(bodyReads, 0);
    assert.equal(dependencies.observed().session, 1);
    assertNoCloud();
  }
});

test("FALLBACK-PHOTO-03 original list validation rejects invalid input and preserves its 500 limit", async () => {
  dependencies.reset();
  for (const body of [{}, { images: [] }, { images: {} }, { images: Array.from({ length: 501 }, image) }]) {
    assert.equal((await deleteImages(requestBody(body))).status, 400);
  }
  const accepted = await deleteImages(requestBody({ images: Array.from({ length: 500 }, image) }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), retained);
  assertNoCloud();
});

test("FALLBACK-PHOTO-04 original path validation rejects traversal, wrong prefixes, types and size", async () => {
  dependencies.reset();
  const invalidImages = [
    { originalPath: "originals/../photo.jpg" },
    { previewPath: "previews/../photo.jpg" },
    { originalPath: "previews/photo.jpg" },
    { previewPath: "originals/photo.jpg" },
    { originalPath: "originals/\\photo.jpg" },
    { previewPath: 7 },
    { originalPath: `originals/${"a".repeat(501)}` },
  ];
  for (const invalid of invalidImages) {
    assert.equal((await deleteImages(requestBody({ images: [invalid] }))).status, 400);
  }
  assertNoCloud();
});

test("FALLBACK-PHOTO-05 actual old client accepts retained HTTP200 through response.ok", async () => {
  dependencies.reset();
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  let calls = 0, acknowledged;
  const images = [image()], before = JSON.stringify(images);
  globalThis.window = { sessionStorage: { getItem: () => "synthetic-fallback-session" } };
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "/api/images");
    assert.equal(init.method, "DELETE");
    acknowledged = await deleteImages(new Request("https://fallback-photo.fixture.invalid/api/images", init));
    assert.equal(acknowledged.ok, true);
    return acknowledged;
  };
  try {
    assert.equal(await deleteStoredImages(images), undefined);
    assert.equal(calls, 1);
    assert.equal(acknowledged.status, 200);
    assert.deepEqual(await acknowledged.json(), retained);
    assert.equal(JSON.stringify(images), before);
    assertNoCloud();
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
