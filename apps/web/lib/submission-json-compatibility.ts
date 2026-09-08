type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entityId(value: JsonRecord) {
  const id = value.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : "";
}

/**
 * 이전 앱이 모르는 필드는 기존 DB 객체에서 보존하되, 사용자가 삭제한 배열 항목은 되살리지 않습니다.
 * 요청 배열의 순서를 기준으로 삼아 소식·사진 드래그 정렬도 그대로 유지합니다.
 */
function mergeEntityArray(existing: unknown, requested: unknown, nested = false): JsonRecord[] {
  if (!Array.isArray(requested)) return [];
  const existingById = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter(isRecord)
      .map((item) => [entityId(item), item]),
  );

  return requested.filter(isRecord).map((item) => {
    const previous = existingById.get(entityId(item));
    const merged = previous ? { ...previous, ...item } : { ...item };
    if (!nested || !previous) return merged;
    return {
      ...merged,
      extraFields: mergeEntityArray(previous.extraFields, item.extraFields),
      links: mergeEntityArray(previous.links, item.links),
      images: mergeEntityArray(previous.images, item.images),
    };
  });
}

/**
 * v1.0.1 앱이 기존 필드만 수정해도 이후 버전이 저장한 JSON 확장 필드를 잃지 않게 합니다.
 * 클라이언트가 보낸 알 수 없는 필드는 검증 단계에서 제거되고, 신뢰할 수 있는 기존 DB 값만 합칩니다.
 */
export function mergeNewsPreservingUnknownFields(existing: unknown, requested: unknown) {
  return mergeEntityArray(existing, requested, true);
}

// 기간은 별도 테이블의 단일 원본이므로 과거/테스트 JSON에 섞인 동일 키도 DB 저장 직전에 제거합니다.
export function stripExternalNewsFields(news: JsonRecord[]) {
  return news.map((item) => {
    const next = { ...item };
    delete next.scheduleRange;
    return next;
  });
}
