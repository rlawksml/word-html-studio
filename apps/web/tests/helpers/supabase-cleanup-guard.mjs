function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * 정리 단계 하나가 실패해도 나머지 정확한 대상을 계속 정리한 뒤,
 * 누락된 정리를 한 번에 테스트 실패로 보고합니다.
 */
export async function runExactCleanup(steps) {
  const failures = [];

  for (const step of steps) {
    try {
      const result = await step.run();
      if (result?.error) failures.push(`${step.label}: ${errorMessage(result.error)}`);
    } catch (error) {
      failures.push(`${step.label}: ${errorMessage(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Supabase Staging QA 데이터 정리에 실패했습니다.\n${failures.join("\n")}`);
  }
}

/** 정확한 테스트 키로 재조회해 DB 레코드가 남지 않았는지 확인합니다. */
export async function assertRowsAbsent(operation, label) {
  const result = await operation;
  if (result.error) throw new Error(`${label}: ${errorMessage(result.error)}`);
  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length > 0) throw new Error(`${label}: 정리 후 ${rows.length}건이 남았습니다.`);
}

/** 같은 폴더의 정확한 파일명만 조회해 Storage 객체가 남지 않았는지 확인합니다. */
export async function assertStorageObjectAbsent(bucket, objectPath, label) {
  const segments = objectPath.split("/");
  const name = segments.pop();
  const folder = segments.join("/");
  if (!name || !folder) throw new Error(`${label}: 확인할 Storage 경로가 올바르지 않습니다.`);

  const result = await bucket.list(folder, { limit: 100, search: name });
  if (result.error) throw new Error(`${label}: ${errorMessage(result.error)}`);
  if ((result.data || []).some((object) => object.name === name)) {
    throw new Error(`${label}: 정리 후 ${name} 객체가 남았습니다.`);
  }
}
