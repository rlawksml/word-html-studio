import { NextRequest, NextResponse } from "next/server";
import { hasWorkspaceWriteAccess, isWorkerRole } from "@/lib/supabase-server";
import { clearWorkerSessionCookie, createWorkerSession, readWorkerSession, setWorkerSessionCookie } from "@/lib/workspace-session";

export async function GET(request: NextRequest) {
  const role = await readWorkerSession(request);
  return role ? NextResponse.json({ role }) : NextResponse.json({ error: "작업자 세션이 만료되었습니다." }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { role?: unknown; code?: unknown; sessionId?: unknown } | null;
  if (!body || !isWorkerRole(body.role) || !hasWorkspaceWriteAccess(body.role, body.code) || typeof body.sessionId !== "string" || !/^[0-9a-f-]{20,80}$/i.test(body.sessionId)) {
    return NextResponse.json({ error: "작업 암호를 확인해 주세요." }, { status: 401 });
  }
  const response = NextResponse.json({ role: body.role });
  setWorkerSessionCookie(response, await createWorkerSession(body.role, body.sessionId));
  return response;
}

export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  clearWorkerSessionCookie(response);
  return response;
}
