import type { NextRequest } from "next/server";
import { createDigestOrderHandlers, readDigestOrderJson } from "@/lib/digest-order-service";
import { createDigestOrderRepository } from "@/lib/digest-order-repository";
import { getSupabaseAdmin, retryFutureJwt } from "@/lib/supabase-server";
import { readWorkerSession, workspaceSessionFingerprint } from "@/lib/workspace-session";

// 기존 서명 cookie+tab header 검증을 재사용하며 모듈 초기화에서는 SDK/환경값을 읽지 않습니다.
const handlers = createDigestOrderHandlers({
  authorize: (request) => readWorkerSession(request as NextRequest),
  fingerprint: (request) => workspaceSessionFingerprint(request.headers.get("x-workspace-session-id") || ""),
  readJson: readDigestOrderJson,
  getStore: () => createDigestOrderRepository(getSupabaseAdmin(), retryFutureJwt),
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
