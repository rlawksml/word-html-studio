import { NextRequest, NextResponse } from "next/server";
import { hasWorkspaceWriteAccess, isWorkerRole } from "@/lib/supabase-server";
import { clearWorkerSessionCookie, createWorkerSession, readWorkerSession, setWorkerSessionCookie } from "@/lib/workspace-session";
import { clearLoginFailures, loginLimit, recordLoginFailure } from "@/lib/login-rate-limit";

// GET: 새로고침 시 현재 작업자 역할을 복원합니다.
export async function GET(request: NextRequest) {
  const role = await readWorkerSession(request);
  return role ? NextResponse.json({ role }) : NextResponse.json({ error: "작업자 세션이 만료되었습니다." }, { status: 401 });
}

// POST: 역할별 암호를 확인하고 서명된 HttpOnly 세션 쿠키를 발급합니다.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { role?: unknown; code?: unknown; sessionId?: unknown } | null;
  const role = body && isWorkerRole(body.role) ? body.role : "unknown";
  const limit = loginLimit(request, role);
  if (limit.retryAfterSeconds) return NextResponse.json({ error: "암호 확인이 여러 번 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });
  if (!body || !isWorkerRole(body.role) || !hasWorkspaceWriteAccess(body.role, body.code) || typeof body.sessionId !== "string" || !/^[0-9a-f-]{20,80}$/i.test(body.sessionId)) {
    const retryAfter = recordLoginFailure(limit.key);
    const headers = retryAfter ? { "retry-after": String(retryAfter) } : undefined;
    return NextResponse.json({ error: "작업 암호를 확인해 주세요." }, { status: 401, headers });
  }
  clearLoginFailures(limit.key);
  const response = NextResponse.json({ role: body.role });
  setWorkerSessionCookie(response, await createWorkerSession(body.role, body.sessionId));
  return response;
}

// DELETE: 로그아웃 시 브라우저의 작업자 세션을 즉시 만료시킵니다.
export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  clearWorkerSessionCookie(response);
  return response;
}
