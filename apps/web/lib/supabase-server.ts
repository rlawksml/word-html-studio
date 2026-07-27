import { createClient } from "@supabase/supabase-js";

// 이 파일은 API Route에서만 사용합니다. SECRET_KEY를 쓰는 admin client를 Client Component에 import하면 안 됩니다.
export const ORIGINAL_IMAGE_BUCKET = "bookstore-news-originals";
export const PREVIEW_IMAGE_BUCKET = "bookstore-news-previews";

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("Supabase 환경변수가 설정되지 않았습니다.");
    this.name = "SupabaseConfigurationError";
  }
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new SupabaseConfigurationError();
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

type SupabaseResult = {
  error: unknown;
};

function futureJwtError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === "PGRST303"
    && typeof value.message === "string"
    && value.message.toLowerCase().includes("jwt issued at future");
}

/**
 * 운영 Worker와 Supabase 게이트웨이의 시계가 순간적으로 어긋날 때 인증 전에 거부된 요청만 재시도합니다.
 * 일반 5xx나 쓰기 타임아웃은 중복 실행 여부가 불명확하므로 여기서 재시도하지 않습니다.
 */
export async function retryFutureJwt<T extends SupabaseResult>(
  operation: () => PromiseLike<T>,
  options: { attempts?: number; delayMs?: number } = {},
) {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 400;
  let result = await operation();
  for (let attempt = 1; attempt < attempts && futureJwtError(result.error); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs * attempt));
    result = await operation();
  }
  return result;
}

export type WorkerRole = "input" | "html";

// 쉼표로 구분한 환경변수 암호를 NFC로 정규화해 한글·영문 자판 입력을 같은 규칙으로 비교합니다.
function accessCodes(role: WorkerRole): readonly string[] {
  const configured = process.env[role === "input" ? "INPUT_ACCESS_CODES" : "HTML_ACCESS_CODES"];
  return configured ? configured.split(",").map((value) => value.normalize("NFC").trim()).filter(Boolean) : [];
}

export function hasWorkspaceWriteAccess(role: unknown, code: unknown) {
  if ((role !== "input" && role !== "html") || typeof code !== "string") return false;
  return accessCodes(role).includes(code.normalize("NFC").trim());
}

export function isWorkerRole(value: unknown): value is WorkerRole {
  return value === "input" || value === "html";
}
