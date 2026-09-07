function projectRefFromUrl(value) {
  const url = new URL(String(value || "").trim());
  const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (!match) throw new Error("SUPABASE_URL이 공식 Supabase 프로젝트 주소가 아닙니다.");
  return match[1];
}

/**
 * Staging이 운영 Supabase를 가리키면 앱 시작 단계에서 연결을 거부합니다.
 * 기존 Production 환경은 새 변수를 넣기 전까지 동일하게 동작하도록 호환성을 유지합니다.
 */
export function assertSupabaseRuntimeTarget({ appEnv, supabaseUrl, expectedProjectRef, blockedProjectRefs }) {
  const actualProjectRef = projectRefFromUrl(supabaseUrl);
  if (!appEnv || appEnv === "production") return actualProjectRef;
  if (appEnv !== "staging") throw new Error("APP_ENV는 staging 또는 production이어야 합니다.");
  if (!expectedProjectRef || expectedProjectRef !== actualProjectRef) {
    throw new Error("Staging Supabase 프로젝트 식별자가 예상값과 다릅니다.");
  }
  const blocked = String(blockedProjectRefs || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (blocked.length === 0) throw new Error("Staging의 운영 Supabase 차단 목록이 비어 있습니다.");
  if (blocked.includes(actualProjectRef)) throw new Error("Staging에서 운영 Supabase 연결을 거부했습니다.");
  return actualProjectRef;
}
