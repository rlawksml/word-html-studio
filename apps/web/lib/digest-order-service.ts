import {
  DigestOrderValidationError,
  isDigestOrderMonth,
  parseDigestOrderCapability,
  parseDigestOrderRecord,
  parseDigestOrderRequest,
  type DigestOrderCapability,
  type DigestOrderRecord,
  type DigestOrderRequest,
} from "./digest-order.ts";

const ERRORS = {
  INVALID_DIGEST_ORDER: [400, "통합본 순서 요청을 확인해 주세요."],
  DIGEST_ORDER_REQUEST_TOO_LARGE: [413, "통합본 순서 요청이 너무 큽니다."],
  DIGEST_ORDER_UNAVAILABLE: [503, "통합본 순서 저장이 아직 설정되지 않았습니다."],
  DIGEST_ORDER_CONFLICT: [409, "다른 작업에서 순서가 변경되었습니다. 최신 순서를 확인해 주세요."],
  DIGEST_ORDER_LEASE_REQUIRED: [423, "통합본 편집 권한을 다시 확인해 주세요."],
  DIGEST_ORDER_SCHEMA_MISMATCH: [503, "통합본 순서 저장소 설정을 확인해 주세요."],
  DIGEST_ORDER_STORAGE_FAILED: [503, "통합본 순서를 확인하거나 저장하지 못했습니다."],
} as const;
export type DigestOrderOperationCode = keyof typeof ERRORS;

// DB 오류/SQL/세션 해시는 담지 않는 고정 public error입니다.
export class DigestOrderOperationError extends Error {
  readonly code: DigestOrderOperationCode;
  readonly status: number;
  readonly latest?: DigestOrderRecord;
  constructor(code: DigestOrderOperationCode, latest?: DigestOrderRecord) {
    super(ERRORS[code][1]);
    this.name = "DigestOrderOperationError";
    this.code = code;
    this.status = ERRORS[code][0];
    this.latest = latest;
  }
}

export interface DigestOrderStore {
  read(month: string): Promise<DigestOrderCapability>;
  save(request: DigestOrderRequest, sessionHash: string): Promise<DigestOrderRecord>;
}

export type DigestOrderDependencies = {
  authorize: (request: Request) => Promise<"input" | "html" | null>;
  fingerprint: (request: Request) => Promise<string>;
  getStore: () => DigestOrderStore;
  readJson?: (request: Request) => Promise<unknown>;
};

const MAX_DIGEST_REQUEST_BYTES = 64 * 1024;

// Content-Length만 신뢰하지 않고 실제 stream도 같은 바이트 상한에서 멈춥니다.
export async function readDigestOrderJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_DIGEST_REQUEST_BYTES)) {
    throw new DigestOrderOperationError("DIGEST_ORDER_REQUEST_TOO_LARGE");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_DIGEST_REQUEST_BYTES);
  let count = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > MAX_DIGEST_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new DigestOrderOperationError("DIGEST_ORDER_REQUEST_TOO_LARGE");
      }
      bytes.set(chunk.value, count - chunk.value.byteLength);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count))) as unknown;
  } catch (error) {
    if (error instanceof DigestOrderOperationError) throw error;
    throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
  } finally {
    reader.releaseLock();
  }
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function queryMonth(request: Request): string {
  const query = new URL(request.url).searchParams;
  const month = query.get("month");
  if (query.getAll("month").length !== 1 || [...query.keys()].some((key) => key !== "month") || !isDigestOrderMonth(month)) {
    throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
  }
  return month;
}

function capability(value: unknown, month: string) {
  try { return parseDigestOrderCapability(value, month); }
  catch { throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED"); }
}

// A successful response must acknowledge this exact write, not just a valid row.
// Unknown acknowledgements are recovered with a later read, never a blind write retry.
export function parseDigestOrderWriteResult(value: unknown, requested: DigestOrderRequest): DigestOrderRecord {
  try {
    const order = parseDigestOrderRecord(value, requested.month);
    const nextRevision = requested.revision + 1;
    if (!Number.isSafeInteger(nextRevision) || order.revision !== nextRevision
      || order.submissionIds.length !== requested.submissionIds.length
      || !order.submissionIds.every((id, index) => id === requested.submissionIds[index])) {
      throw new Error("Unconfirmed digest write");
    }
    return order;
  } catch { throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED"); }
}

export function createDigestOrderHandlers(dependencies: DigestOrderDependencies) {
  const handle = async (request: Request, method: "GET" | "PUT") => {
    let month = "";
    try {
      if (request.method !== method) return response({ code: "METHOD_NOT_ALLOWED", error: "지원하지 않는 요청입니다." }, 405);
      // 본문·설정·DB port보다 먼저 서명 쿠키/탭 세션의 역할을 확인합니다.
      const role = await dependencies.authorize(request);
      if (!role) return response({ code: "WORKER_SESSION_REQUIRED", error: "작업자 세션이 만료되었습니다." }, 401);
      if (role !== "html") return response({ code: "HTML_ROLE_REQUIRED", error: "HTML 편집자만 사용할 수 있습니다." }, 403);
      month = queryMonth(request);
      if (method === "GET") return response(capability(await dependencies.getStore().read(month), month));
      const requested = parseDigestOrderRequest(await (dependencies.readJson ?? readDigestOrderJson)(request), month);
      if (requested.revision === Number.MAX_SAFE_INTEGER) throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
      const sessionHash = await dependencies.fingerprint(request);
      if (typeof sessionHash !== "string" || sessionHash.length !== 64 || !/^[a-f0-9]{64}$/.test(sessionHash)) throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
      const order = parseDigestOrderWriteResult(await dependencies.getStore().save(requested, sessionHash), requested);
      return response({ available: true, order });
    } catch (error) {
      if (error instanceof DigestOrderValidationError) return response({ code: "INVALID_DIGEST_ORDER", error: "통합본 순서 요청을 확인해 주세요." }, 400);
      const failure = error instanceof DigestOrderOperationError ? error : new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
      let latest: DigestOrderRecord | undefined;
      if (failure.code === "DIGEST_ORDER_CONFLICT" && failure.latest) {
        try { latest = parseDigestOrderRecord(failure.latest, month); } catch { /* 미확인/다른 월 자료를 응답에 넣지 않습니다. */ }
      }
      return response({ code: failure.code, error: failure.message, ...(latest ? { latest } : {}) }, failure.status);
    }
  };
  return { GET: (request: Request) => handle(request, "GET"), PUT: (request: Request) => handle(request, "PUT") };
}
