// Fixed fallback manifest and reviewed toolchain graph; no npm script evaluation.
export const PACKAGE_SHA256 = "c63c7557defcc7e7977a60d38e3ba91fe7b5b323f1839a673db3c148e5af0ad1";
export const LOCK_SHA256 = "7d0fbfd20e10d0758b12299d4d0e8f4705ad1e6000d198789338207727f2b8d9";
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
