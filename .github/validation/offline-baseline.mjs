// Fixed fallback manifest and reviewed toolchain graph; no npm script evaluation.
export const PACKAGE_SHA256 = "aa2a7349fc01bbe07de451f0ed95d9bcf649307c1573a73f7a237eb8a9099fa1";
export const LOCK_SHA256 = "37040aeb02f94e7cbb23672a18b1b7d87d6e37d935b9ed44b0d0fa7069cfc90c";
// Keep the old npm test command unchanged. The isolated profile adds only the
// five no-physical-delete cases below; JSON preservation has its own 10-case suite.
export const PACKAGE_TESTS = Object.freeze([
  "tests/rendered-html.test.mjs",
  "tests/workspace-client-stability.test.mjs",
]);
export const TESTS = Object.freeze([
  ...PACKAGE_TESTS,
  "tests/fallback-photo-retention.test.mjs",
]);
// Static top-level test declarations in the exact three files above, not a claim
// that these tests have run. Any counter mismatch, skip/cancellation/todo fails.
export const EXPECTED_TESTS = 30;

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
  NO_COLOR: "1",
  WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: "/scratch/wrangler.log",
  XDG_CONFIG_HOME: "/scratch/config", XDG_DATA_HOME: "/scratch/data",
});
export const VOLUME_OPTIONS = Object.freeze({
  type: "tmpfs", device: "tmpfs",
  o: "size=2g,uid=65534,gid=65534,mode=0700,nosuid,nodev",
});
export const LABEL = "bookstore.offline-qa";
