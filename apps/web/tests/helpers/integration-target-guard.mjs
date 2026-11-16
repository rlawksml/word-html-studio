// Test-only allowlist: changing the test project requires explicit code review.
const STAGING_REF = "kriyjyyudngtibrtkylf";
const PRODUCTION_REF = "kdigttaghqubfjsmbngl";

export function assertIntegrationTarget(env) {
  if (env.APP_ENV !== "staging") throw new Error("Integration tests require APP_ENV=staging.");
  const expectedUrl = `https://${STAGING_REF}.supabase.co`;
  // Exact raw matching also rejects credentials, ports, paths and query strings.
  if (![expectedUrl, `${expectedUrl}/`].includes(env.SUPABASE_URL)) {
    throw new Error("Integration tests require the approved Staging URL.");
  }
  if (env.EXPECTED_SUPABASE_PROJECT_REF !== STAGING_REF) throw new Error("Integration Staging project mismatch.");
  const blocked = String(env.BLOCKED_SUPABASE_PROJECT_REFS || "").split(",").map((ref) => ref.trim());
  if (!blocked.includes(PRODUCTION_REF) || blocked.includes(STAGING_REF)) {
    throw new Error("Integration Production denylist is missing or unsafe.");
  }
}
