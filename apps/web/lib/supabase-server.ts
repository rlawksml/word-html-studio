import { createClient } from "@supabase/supabase-js";

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

export type WorkerRole = "input" | "html";

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
