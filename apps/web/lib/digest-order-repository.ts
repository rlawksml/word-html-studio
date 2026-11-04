import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseSchemaCapabilities } from "../scripts/supabase-schema.mjs";
import { parseDigestOrderRecord, parseDigestOrderRequest, type DigestOrderCapability, type DigestOrderRecord, type DigestOrderRequest } from "./digest-order.ts";
import { DigestOrderOperationError, parseDigestOrderWriteResult, type DigestOrderStore } from "./digest-order-service.ts";

type Client = Pick<SupabaseClient, "from" | "rpc">;
type Result = { data?: unknown; error: unknown };
type Execute = <T extends { error: unknown }>(operation: () => PromiseLike<T>) => Promise<T>;
const defaultExecute: Execute = async (operation) => operation();
const SELECT = "month,submission_ids,revision,updated_at";

function rowRecord(row: unknown, month: string): DigestOrderRecord {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
  const value = row as Record<string, unknown>;
  try {
    return parseDigestOrderRecord({ month: value.month, submissionIds: value.submission_ids, revision: value.revision, updatedAt: value.updated_at }, month);
  } catch {
    throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
  }
}

// Client/execute는 실제 SDK와 호환되는 port이며 키/환경변수를 읽지 않습니다.
// execute 재시도는 기존 retryFutureJwt의 인증 전 PGRST303 경계만 허용합니다.
export function createDigestOrderRepository(client: Client, execute: Execute = defaultExecute): DigestOrderStore {
  async function installed() {
    try {
      const result = await readSupabaseSchemaCapabilities(client, execute);
      return result.digestOrderAvailable;
    } catch (error) {
      if (error instanceof Error && error.message === "DIGEST_ORDER_SCHEMA_VERSION_UNSUPPORTED") {
        throw new DigestOrderOperationError("DIGEST_ORDER_SCHEMA_MISMATCH");
      }
      throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
    }
  }
  async function read(month: string): Promise<DigestOrderCapability> {
    parseDigestOrderRequest({ month, submissionIds: [], revision: 0 });
    if (!await installed()) return { available: false };
    try {
      const result: Result = await execute(() => client.from("monthly_digest_orders").select(SELECT).eq("month", month).maybeSingle());
      if (result.error) throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
      const order = result.data === null ? { month, submissionIds: [], revision: 0, updatedAt: "" } : rowRecord(result.data, month);
      return { available: true, order };
    } catch (error) {
      if (error instanceof DigestOrderOperationError) throw error;
      throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
    }
  }
  async function save(value: DigestOrderRequest, sessionHash: string): Promise<DigestOrderRecord> {
    const requested = parseDigestOrderRequest(value);
    if (requested.revision === Number.MAX_SAFE_INTEGER) throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
    if (typeof sessionHash !== "string" || sessionHash.length !== 64 || !/^[a-f0-9]{64}$/.test(sessionHash)) throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
    if (!await installed()) throw new DigestOrderOperationError("DIGEST_ORDER_UNAVAILABLE");
    let result: Result;
    try {
      result = await execute(() => client.rpc("save_monthly_digest_order", {
        p_month: requested.month, p_submission_ids: requested.submissionIds,
        p_expected_revision: requested.revision, p_session_hash: sessionHash,
      }).maybeSingle());
    } catch { throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED"); }
    if (!result.error) return parseDigestOrderWriteResult(rowRecord(result.data, requested.month), requested);
    const code = typeof result.error === "object" && result.error ? (result.error as { code?: unknown }).code : "";
    if (code === "PDI01") throw new DigestOrderOperationError("INVALID_DIGEST_ORDER");
    if (code === "PDL01") throw new DigestOrderOperationError("DIGEST_ORDER_LEASE_REQUIRED");
    if (code === "PDC01") {
      let latest: DigestOrderRecord | undefined;
      try { const current = await read(requested.month); if (current.available) latest = current.order; } catch { /* 확인하지 못한 값은 응답에 넣지 않습니다. */ }
      throw new DigestOrderOperationError("DIGEST_ORDER_CONFLICT", latest);
    }
    throw new DigestOrderOperationError("DIGEST_ORDER_STORAGE_FAILED");
  }
  return { read, save };
}
