// 통합본 순서는 기존 Submission의 내용/updatedAt과 분리해 다룹니다.
// 이 모듈은 검증·화면 투영·응답 분류만 수행하며 저장소/네트워크에 접근하지 않습니다.
export const MAX_DIGEST_ORDER_ITEMS = 500;

export type DigestOrderRecord = {
  month: string;
  submissionIds: number[];
  revision: number;
  updatedAt: string;
};

export type DigestOrderRequest = Pick<DigestOrderRecord, "month" | "submissionIds" | "revision">;
export type DigestOrderCapability = { available: false } | { available: true; order: DigestOrderRecord };
export type DigestOrderRecovery = "confirmed" | "conflict" | "unknown";

export class DigestOrderValidationError extends Error {
  constructor() {
    // 요청값이나 서버 응답 본문을 오류/로그에 섞지 않습니다.
    super("통합본 순서 정보가 올바르지 않습니다.");
    this.name = "DigestOrderValidationError";
  }
}

function invalid(): never {
  throw new DigestOrderValidationError();
}

export function isDigestOrderMonth(value: unknown): value is string {
  return typeof value === "string" && value.length === 7 && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthValue(value: unknown, expectedMonth?: string): string {
  if (!isDigestOrderMonth(value)) return invalid();
  if (expectedMonth !== undefined && (!isDigestOrderMonth(expectedMonth) || value !== expectedMonth)) return invalid();
  return value;
}

function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

// JSON DTO만 받습니다. 클래스/접근자/예상 밖 필드는 조용히 버리지 않고 거부합니다.
function fields(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  if (Object.getOwnPropertySymbols(value).length) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function idsValue(value: unknown): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > MAX_DIGEST_ORDER_ITEMS || Object.getOwnPropertySymbols(value).length) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) return invalid();
  const ids: number[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !safeInteger(descriptor.value, 1)
      || seen.has(descriptor.value)) return invalid();
    ids.push(descriptor.value);
    seen.add(descriptor.value);
  }
  return ids;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Postgres가 반환하는 소수초 최대6자리와 UTC offset을 지원합니다.
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

export function parseDigestOrderRequest(value: unknown, expectedMonth?: string): DigestOrderRequest {
  const record = fields(value, ["month", "submissionIds", "revision"]);
  const month = monthValue(record.month, expectedMonth);
  if (!safeInteger(record.revision, 0)) return invalid();
  return { month, submissionIds: idsValue(record.submissionIds), revision: record.revision };
}

export function parseDigestOrderRecord(value: unknown, expectedMonth?: string): DigestOrderRecord {
  const record = fields(value, ["month", "submissionIds", "revision", "updatedAt"]);
  const request = parseDigestOrderRequest({ month: record.month, submissionIds: record.submissionIds, revision: record.revision }, expectedMonth);
  // revision0은 아직 저장된 행이 없다는 sentinel입니다. 저장 요청의 rev0과 구별합니다.
  if (request.revision === 0) {
    if (request.submissionIds.length || record.updatedAt !== "") return invalid();
  } else if (!validTimestamp(record.updatedAt)) return invalid();
  return { ...request, updatedAt: record.updatedAt as string };
}

export function parseDigestOrderCapability(value: unknown, expectedMonth?: string): DigestOrderCapability {
  if (expectedMonth !== undefined) monthValue(expectedMonth);
  if (value === null || typeof value !== "object") return invalid();
  const availableDescriptor = Object.getOwnPropertyDescriptor(value, "available");
  if (!availableDescriptor || !("value" in availableDescriptor)) return invalid();
  if (availableDescriptor.value === false) {
    fields(value, ["available"]);
    return { available: false };
  }
  const record = fields(value, ["available", "order"]);
  if (record.available !== true) return invalid();
  return { available: true, order: parseDigestOrderRecord(record.order, expectedMonth) };
}

type DigestSubmission = { id: number; month: string; status: "draft" | "completed" };

export function projectDigestOrder<T extends DigestSubmission>(
  records: readonly T[], month: string, savedIds: readonly number[],
): T[] {
  monthValue(month);
  const ids = idsValue(savedIds);
  const seen = new Set<number>();
  for (const record of records) {
    if (!safeInteger(record.id, 1) || seen.has(record.id) || !isDigestOrderMonth(record.month)
      || (record.status !== "draft" && record.status !== "completed")) return invalid();
    seen.add(record.id);
  }
  const completed = new Map(records.filter((record) => record.month === month && record.status === "completed")
    .map((record) => [record.id, record]));
  const projected: T[] = [];
  for (const id of ids) {
    const record = completed.get(id);
    if (record) {
      projected.push(record);
      completed.delete(id);
    }
  }
  // 저장 후 새로 완료된 소식은 GET updated_at 순서에 흔들리지 않도록 ID순으로 덧붙입니다.
  return [...projected, ...[...completed.values()].sort((left, right) => left.id - right.id)];
}

export function moveDigestOrder(ids: readonly number[], draggedId: number, targetId: number): number[] {
  const next = idsValue(ids);
  const from = next.indexOf(draggedId), to = next.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function classifyDigestOrderRecovery(requested: unknown, latest: unknown): DigestOrderRecovery {
  try {
    const request = parseDigestOrderRequest(requested);
    const record = parseDigestOrderRecord(latest, request.month);
    if (record.revision <= request.revision) return "unknown";
    return record.submissionIds.length === request.submissionIds.length
      && record.submissionIds.every((id, index) => id === request.submissionIds[index]) ? "confirmed" : "conflict";
  } catch {
    // 미확인 상태는 성공이나 빈 순서로 변환하지 않습니다. 호출자는 자동 덮어쓰기를 멈춥니다.
    return "unknown";
  }
}

export function isCurrentDigestResponse(
  requestMonth: string, currentMonth: string, requestEpoch: number, currentEpoch: number,
): boolean {
  return isDigestOrderMonth(requestMonth) && isDigestOrderMonth(currentMonth)
    && requestMonth === currentMonth && safeInteger(requestEpoch, 0)
    && safeInteger(currentEpoch, 0) && requestEpoch === currentEpoch;
}
