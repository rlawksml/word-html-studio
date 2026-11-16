import {
  classifyDigestOrderRecovery, isDigestOrderMonth, moveDigestOrder, parseDigestOrderCapability,
  parseDigestOrderRecord, parseDigestOrderRequest, projectDigestOrder,
  type DigestOrderCapability, type DigestOrderRecord, type DigestOrderRequest,
} from "./digest-order.ts";

const MESSAGES = {
  SESSION_REQUIRED: "작업자 접속이 만료되었습니다. 다시 접속해 주세요.",
  HTML_ROLE_REQUIRED: "HTML 편집자만 통합본 순서를 저장할 수 있습니다.",
  INVALID_DIGEST_ORDER: "통합본 순서 요청을 확인해 주세요.",
  DIGEST_ORDER_CONFLICT: "다른 작업에서 순서가 변경되었습니다. 최신 순서를 다시 불러와 주세요.",
  DIGEST_ORDER_LEASE_REQUIRED: "다른 작업자가 편집 중이거나 편집 권한이 만료되었습니다.",
  DIGEST_ORDER_UNAVAILABLE: "통합본 순서 저장이 아직 설정되지 않았습니다. 미리보기와 복사는 사용할 수 있습니다.",
  DIGEST_ORDER_STORAGE_FAILED: "통합본 순서를 확인하지 못했습니다. 최신 순서를 다시 불러와 주세요.",
  DIGEST_ORDER_TIMEOUT: "순서 확인 시간이 길어지고 있습니다. 연결을 확인해 주세요.",
  DIGEST_ORDER_CANCELLED: "통합본 순서 작업을 취소했습니다.",
} as const;
type ErrorCode = keyof typeof MESSAGES;

export class DigestOrderClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly latest?: DigestOrderRecord;
  constructor(code: ErrorCode, status = 0, latest?: DigestOrderRecord) {
    super(MESSAGES[code]);
    this.name = "DigestOrderClientError";
    this.code = code;
    this.status = status;
    this.latest = latest;
  }
}

export type DigestOrderSaveResult =
  | { kind: "saved" | "confirmed"; order: DigestOrderRecord }
  | { kind: "conflict"; latest: DigestOrderRecord }
  | { kind: "unknown" };
type ClientOptions = {
  sessionHeaders: () => Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

// Only an explicit drag builds a new payload. Reading never prunes stored IDs.
// Preserve hidden draft positions; prune missing/foreign-month IDs only in this new write.
export function digestOrderAfterMove<T extends { id: number; month: string; status: "draft" | "completed" }>(
  records: readonly T[], month: string, savedIds: readonly number[], dragged: number, target: number,
): number[] {
  const visible = projectDigestOrder(records, month, savedIds).map((item) => item.id);
  const moved = moveDigestOrder(visible, dragged, target);
  const current = new Map(records.filter((item) => item.month === month).map((item) => [item.id, item]));
  const retained = savedIds.filter((id) => current.has(id));
  const known = new Set(retained);
  const appended = [...retained, ...visible.filter((id) => !known.has(id))];
  let index = 0;
  return appended.map((id) => current.get(id)?.status === "completed" ? moved[index++] : id);
}

export function createDigestOrderClient(options: ClientOptions) {
  const transport = options.fetch ?? globalThis.fetch;
  const timeoutMs = Math.min(15_000, Math.max(1, options.timeoutMs ?? 8_000));

  async function bounded<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw new DigestOrderClientError("DIGEST_ORDER_CANCELLED");
    const controller = new AbortController();
    let rejectAbort: (error: Error) => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = () => {
      rejectAbort(new DigestOrderClientError("DIGEST_ORDER_CANCELLED"));
      controller.abort();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      rejectAbort(new DigestOrderClientError("DIGEST_ORDER_TIMEOUT"));
      controller.abort();
    }, timeoutMs);
    try { return await Promise.race([operation(controller.signal), aborted]); }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  async function exchange(month: string, method: "GET" | "PUT", body: string | undefined, signal?: AbortSignal) {
    if (!isDigestOrderMonth(month)) throw new DigestOrderClientError("INVALID_DIGEST_ORDER", 400);
    return bounded(signal, async (requestSignal) => {
      const response = await transport(`/api/digest-order?month=${encodeURIComponent(month)}`, {
        method, cache: "no-store", credentials: "same-origin", signal: requestSignal,
        headers: { ...options.sessionHeaders(), ...(method === "PUT" ? { "content-type": "application/json" } : {}) },
        ...(body === undefined ? {} : { body }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const statusCodes: Record<number, ErrorCode> = {
          400: "INVALID_DIGEST_ORDER", 401: "SESSION_REQUIRED", 403: "HTML_ROLE_REQUIRED",
          409: "DIGEST_ORDER_CONFLICT", 413: "INVALID_DIGEST_ORDER", 423: "DIGEST_ORDER_LEASE_REQUIRED",
        };
        const code = statusCodes[response.status] ?? "DIGEST_ORDER_STORAGE_FAILED";
        let latest: DigestOrderRecord | undefined;
        if (code === "DIGEST_ORDER_CONFLICT") {
          try { latest = parseDigestOrderRecord((value as { latest?: unknown } | null)?.latest, month); } catch { /* Unconfirmed. */ }
        }
        throw new DigestOrderClientError(code, response.status, latest);
      }
      try { return parseDigestOrderCapability(value, month); }
      catch { throw new DigestOrderClientError("DIGEST_ORDER_STORAGE_FAILED", response.status); }
    });
  }

  async function read(month: string, signal?: AbortSignal): Promise<DigestOrderCapability> {
    try { return await exchange(month, "GET", undefined, signal); }
    catch (error) {
      if (signal?.aborted) throw new DigestOrderClientError("DIGEST_ORDER_CANCELLED");
      if (error instanceof DigestOrderClientError) throw error;
      throw new DigestOrderClientError("DIGEST_ORDER_STORAGE_FAILED");
    }
  }

  async function save(value: DigestOrderRequest, signal?: AbortSignal): Promise<DigestOrderSaveResult> {
    let requested: DigestOrderRequest;
    try {
      requested = parseDigestOrderRequest(value);
      if (requested.revision === Number.MAX_SAFE_INTEGER) throw new Error("Cannot increment");
    } catch { throw new DigestOrderClientError("INVALID_DIGEST_ORDER", 400); }
    // Parsing copies IDs. Stringify before awaiting prevents UI changes altering an in-flight request.
    const body = JSON.stringify(requested);
    try {
      const capability = await exchange(requested.month, "PUT", body, signal);
      if (!capability.available) throw new DigestOrderClientError("DIGEST_ORDER_STORAGE_FAILED");
      const order = capability.order;
      if (order.revision !== requested.revision + 1 || order.submissionIds.length !== requested.submissionIds.length
        || !order.submissionIds.every((id, index) => id === requested.submissionIds[index])) {
        throw new DigestOrderClientError("DIGEST_ORDER_STORAGE_FAILED");
      }
      return { kind: "saved", order };
    } catch (error) {
      if (signal?.aborted || (error instanceof DigestOrderClientError && error.code === "DIGEST_ORDER_CANCELLED")) {
        throw new DigestOrderClientError("DIGEST_ORDER_CANCELLED");
      }
      if (error instanceof DigestOrderClientError && error.status >= 400 && error.status < 500) throw error;
      // The write may already have committed. Exactly one GET; never repeat PUT automatically.
      try {
        const latest = await read(requested.month, signal);
        if (!latest.available) return { kind: "unknown" };
        const recovery = classifyDigestOrderRecovery(requested, latest.order);
        if (recovery === "confirmed") return { kind: "confirmed", order: latest.order };
        if (recovery === "conflict") return { kind: "conflict", latest: latest.order };
      } catch { /* A failed recovery read is not a successful write. */ }
      if (signal?.aborted) throw new DigestOrderClientError("DIGEST_ORDER_CANCELLED");
      return { kind: "unknown" };
    }
  }
  return { read, save };
}

export type DigestOrderClient = ReturnType<typeof createDigestOrderClient>;
