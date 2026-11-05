// Fixed existing package/lock baseline. No upgrades or npm script evaluation.
export const PACKAGE_SHA256 = "cdc5fde96aa6665a7642b256a2b4329e2a9dee147bbd12981df3c35e38199fa9";
export const LOCK_SHA256 = "18ff641e6f54f79d3c6158ba8717309e7e0e237eb65d7fdff6012b39d1433f34";
export const TESTS = Object.freeze([
  "tests/html-line-breaks.test.mjs",
  "tests/rendered-html.test.mjs",
  "tests/async-loading-feedback.test.mjs",
  "tests/workspace-client-stability.test.mjs",
  "tests/image-retention-policy.test.mjs",
  "tests/submission-completion.test.mjs",
  "tests/submission-url-validation.test.mjs",
  "tests/news-date-selection.test.mjs",
  "tests/news-schedule-range.test.mjs",
  "tests/publication-month.test.mjs",
  "tests/schema-compatibility.test.mjs",
  "tests/backup-safety.test.mjs",
  "tests/supabase-environment.test.mjs",
  "tests/deployment-target.test.mjs",
  "tests/access-code-normalization.test.mjs",
  "tests/supabase-cleanup-guard.test.mjs",
  "tests/integration-safety-block.test.mjs",
  "tests/test-owned-ledger.test.mjs",
  "tests/test-owned-supabase-adapter.test.mjs",
  "tests/fixture-response-observer.test.mjs",
  "tests/digest-order.test.mjs",
  "tests/digest-order-service.test.mjs",
  "tests/digest-order-repository.test.mjs",
  "tests/digest-order-backup.test.mjs",
  "tests/digest-order-client.test.mjs",
  "tests/digest-response-observer.test.mjs",
]);
// Static top-level test declarations in the exact 26 files above, not a claim
// that these tests have run. Any TAP mismatch, skip/cancellation/todo fails.
export const EXPECTED_TESTS = 246;

export const BASE_ENV = Object.freeze({
  PATH: "/usr/bin:/bin", HOME: "/scratch", TMPDIR: "/scratch",
  XDG_CACHE_HOME: "/scratch/cache", TZ: "UTC", UV_THREADPOOL_SIZE: "2",
});
export const PREP_ENV = Object.freeze({
  ...BASE_ENV, SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
  NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/ca-certificates.crt",
  NPM_CONFIG_USERCONFIG: "/trusted/npm-user.conf", NPM_CONFIG_GLOBALCONFIG: "/trusted/npm-global.conf",
  NPM_CONFIG_CACHE: "/scratch/npm-cache", NPM_CONFIG_IGNORE_SCRIPTS: "true",
});
export const APP_ENV = Object.freeze({
  ...BASE_ENV, CI: "1", NEXT_TELEMETRY_DISABLED: "1",
  WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: "/scratch/wrangler.log",
  XDG_CONFIG_HOME: "/scratch/config", XDG_DATA_HOME: "/scratch/data",
});
export const VOLUME_OPTIONS = Object.freeze({
  type: "tmpfs", device: "tmpfs",
  o: "size=2g,uid=65534,gid=65534,mode=0700,nosuid,nodev",
});
export const LABEL = "bookstore.offline-qa";
