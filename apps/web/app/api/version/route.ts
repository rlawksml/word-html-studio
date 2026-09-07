import { NextResponse } from "next/server";
import {
  APP_PRODUCT_VERSION,
  APP_SCHEMA_COMPONENT,
  APP_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
} from "@/lib/release-version";
import { getSupabaseAdmin, retryFutureJwt, SupabaseConfigurationError } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// 운영자가 앱 코드와 실제 DB 스키마의 조합을 읽기 전용으로 확인하는 공개 상태 API입니다.
export async function GET() {
  try {
    const result = await retryFutureJwt(() => (
      getSupabaseAdmin()
        .from("app_schema_versions")
        .select("version")
        .eq("component", APP_SCHEMA_COMPONENT)
        .maybeSingle()
    ));
    if (result.error) throw result.error;
    const databaseSchemaVersion = Number(result.data?.version || LEGACY_SCHEMA_VERSION);
    return NextResponse.json({
      productVersion: APP_PRODUCT_VERSION,
      commitSha: process.env.APP_COMMIT_SHA || "",
      databaseSchemaVersion,
      expectedSchemaVersion: APP_SCHEMA_VERSION,
      compatible: databaseSchemaVersion >= LEGACY_SCHEMA_VERSION,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return NextResponse.json({ error: "버전 확인에 필요한 저장소 연결 정보가 없습니다." }, { status: 503 });
    }
    console.error("version check failed", error);
    return NextResponse.json({ error: "데이터 스키마 버전을 확인하지 못했습니다." }, { status: 503 });
  }
}
