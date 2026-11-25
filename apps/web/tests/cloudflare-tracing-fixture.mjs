// Node-only fixture for vinext's optional Cloudflare framework tracing import.
// It does not mock sessions, routes, storage, fetch, or any application module.
import { registerHooks } from "node:module";

export function installCloudflareTracingFixture(buildDirectory) {
  const fixtureUrl = "bookstore-node-fixture:cloudflare-tracing-unavailable";
  return registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "cloudflare:workers" && context.parentURL?.startsWith(buildDirectory.href)) {
        return { url: fixtureUrl, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === fixtureUrl) return {
        format: "module", shortCircuit: true,
        source: "export const tracing = undefined;",
      };
      return next(url, context);
    },
  });
}
