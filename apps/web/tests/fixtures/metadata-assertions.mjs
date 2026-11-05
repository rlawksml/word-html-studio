import assert from "node:assert/strict";

// Root https://host and https://host/ resolve to the same canonical URL.
// Preserve the exact scheme/host/path/query/fragment requirement without
// depending on HTML attribute order or a renderer's root-slash serialization.
export function assertCanonicalUrl(html, expectedUrl) {
  const canonicalLinks = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({
      rel: /\srel="([^"]*)"/.exec(tag)?.[1],
      href: /\shref="([^"]*)"/.exec(tag)?.[1],
    }))
    .filter(({ rel }) => rel === "canonical");
  assert.equal(canonicalLinks.length, 1, "exactly one canonical link is required");
  assert.equal(typeof canonicalLinks[0].href, "string");
  // No base is supplied: a relative canonical does not satisfy this contract.
  assert.equal(new URL(canonicalLinks[0].href).href, new URL(expectedUrl).href);
}
