import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, SupabaseConfigurationError, type WorkerRole } from "@/lib/supabase-server";
import { readWorkerSession, workspaceSessionFingerprint } from "@/lib/workspace-session";
import { readWorkspaceJson, WorkspaceValidationError } from "@/lib/workspace-validation";

const LEASE_SECONDS = 180;

type PresenceBody = {
  scope?: unknown;
  month?: unknown;
  bookstoreId?: unknown;
  sessionId?: unknown;
};

function resourceKey(body: PresenceBody) {
  if (typeof body.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) {
    throw new WorkspaceValidationError("발행 월을 확인해 주세요.");
  }
  if (body.scope === "digest") return `digest:${body.month}`;
  const bookstoreId = Number(body.bookstoreId);
  if (body.scope !== "submission" || !Number.isSafeInteger(bookstoreId) || bookstoreId <= 0) {
    throw new WorkspaceValidationError("편집할 책방을 확인해 주세요.");
  }
  return `submission:${body.month}:${bookstoreId}`;
}

async function authenticatedRequest(request: NextRequest) {
  const body = await readWorkspaceJson(request) as PresenceBody;
  const sessionId = request.headers.get("x-workspace-session-id") || (typeof body.sessionId === "string" ? body.sessionId : "");
  const role = await readWorkerSession(request, sessionId);
  if (!role) return { response: NextResponse.json({ error: "작업자 세션이 만료되었습니다." }, { status: 401 }) };
  return { body, role, sessionHash: await workspaceSessionFingerprint(sessionId) };
}

// 현재 편집 대상을 3분간 확보합니다. 같은 세션의 요청은 갱신하고 만료된 임대는 다음 작업자가 인계합니다.
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticatedRequest(request);
    if (auth.response) return auth.response;
    const key = resourceKey(auth.body);
    const result = await getSupabaseAdmin().rpc("acquire_editing_lease", {
      requested_resource_key: key,
      requested_session_hash: auth.sessionHash,
      requested_role: auth.role,
      lease_seconds: LEASE_SECONDS,
    }).maybeSingle();
    if (result.error) throw result.error;
    const lease = result.data as { owned?: boolean; active_role?: WorkerRole; active_expires_at?: string } | null;
    return NextResponse.json({
      owned: lease?.owned === true,
      activeRole: lease?.active_role || auth.role,
      expiresAt: lease?.active_expires_at || "",
    });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SupabaseConfigurationError) return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
    console.error("editing presence heartbeat failed", error);
    return NextResponse.json({ error: "다른 작업자의 편집 상태를 확인하지 못했습니다." }, { status: 500 });
  }
}

// 화면 이동과 로그아웃에서 자신의 임대만 해제합니다. 비정상 종료 시에도 3분 후 자동 만료됩니다.
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticatedRequest(request);
    if (auth.response) return auth.response;
    const result = await getSupabaseAdmin().from("editing_leases").delete()
      .eq("resource_key", resourceKey(auth.body))
      .eq("session_hash", auth.sessionHash);
    if (result.error) throw result.error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SupabaseConfigurationError) return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
    console.error("editing presence release failed", error);
    return NextResponse.json({ error: "편집 상태를 정리하지 못했습니다." }, { status: 500 });
  }
}
