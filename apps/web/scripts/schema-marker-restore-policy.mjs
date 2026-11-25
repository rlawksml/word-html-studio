import { canonicalJson, sha256 } from "./backup-utils.mjs";

export const SCHEMA_MARKER_TABLE = "app_schema_versions";
const MAX_COMPONENTS = 32;
const plans = new WeakMap();

function invalid() {
  throw new Error("SCHEMA_MARKER_RESTORE_INVALID_ROWS");
}

function validTimestamp(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, zoneHour, zoneMinute] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && (zone === "Z" || (Number(zoneHour) <= 23 && Number(zoneMinute) <= 59))
    && Number.isFinite(Date.parse(value));
}

// SDK/파일에서 받은 DTO를 엄격히 복사합니다. getter를 실행하거나 미래 필드를 버리지 않습니다.
function snapshotRows(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > MAX_COMPONENTS || Object.getOwnPropertySymbols(value).length) return invalid();
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(entries).length !== value.length + 1) return invalid();
  const seen = new Set(), result = [];
  for (let index = 0; index < value.length; index++) {
    const entry = entries[String(index)];
    if (!entry || !("value" in entry) || !entry.enumerable) return invalid();
    const row = entry.value;
    if (!row || typeof row !== "object" || Array.isArray(row)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(row))
      || Object.getOwnPropertySymbols(row).length) return invalid();
    const fields = Object.getOwnPropertyDescriptors(row);
    const keys = Object.keys(fields);
    if (keys.length !== 3 || keys.some((key) => !["component", "version", "applied_at"].includes(key))
      || keys.some((key) => !("value" in fields[key]) || !fields[key].enumerable)) return invalid();
    const component = fields.component.value, version = fields.version.value, appliedAt = fields.applied_at.value;
    const componentMatch = typeof component === "string" ? /^[a-z][a-z0-9_]{0,63}$/.exec(component) : null;
    if (!componentMatch || componentMatch[0] !== component || seen.has(component)
      || !Number.isSafeInteger(version) || version < 1 || !validTimestamp(appliedAt)) return invalid();
    seen.add(component);
    const copy = {};
    // 대상 전체 행 지문은 키와 행의 원래 순서를 포함합니다. 의미 비교와 구분합니다.
    for (const key of keys) copy[key] = fields[key].value;
    result.push(Object.freeze(copy));
  }
  return Object.freeze(result);
}

function semanticFingerprint(rows) {
  return sha256(canonicalJson(rows.map(({ component, version }) => ({ component, version }))
    .sort((left, right) => left.component < right.component ? -1 : left.component > right.component ? 1 : 0)));
}

// marker는 DB를 준비한 migration의 결과입니다. 원본 값을 target에 쓰거나 시간을 맞추지 않습니다.
export function planSchemaMarkerRestore({ sourceRows, currentRows }) {
  const source = snapshotRows(sourceRows), target = snapshotRows(currentRows);
  const semanticSha256 = semanticFingerprint(source);
  if (semanticSha256 !== semanticFingerprint(target)) throw new Error("SCHEMA_MARKER_RESTORE_SCHEMA_MISMATCH");
  const targetSha256 = sha256(canonicalJson(target));
  const plan = Object.freeze({ action: "preserve", rows: Object.freeze([]), components: source.length });
  plans.set(plan, Object.freeze({ semanticSha256, targetSha256 }));
  return plan;
}

// preflight 후 대상 marker는 값·순서까지 그대로여야 합니다. 계획 복사/위조도 거부합니다.
export function verifySchemaMarkerRestore({ plan, currentRows }) {
  const evidence = plans.get(plan);
  if (!evidence) throw new Error("SCHEMA_MARKER_RESTORE_INVALID_PLAN");
  const target = snapshotRows(currentRows);
  if (semanticFingerprint(target) !== evidence.semanticSha256) throw new Error("SCHEMA_MARKER_RESTORE_SCHEMA_MISMATCH");
  if (sha256(canonicalJson(target)) !== evidence.targetSha256) throw new Error("SCHEMA_MARKER_RESTORE_TARGET_CHANGED");
  return Object.freeze({ mode: "preserved-target-markers", components: plan.components,
    semanticSha256: evidence.semanticSha256, targetSha256: evidence.targetSha256 });
}
