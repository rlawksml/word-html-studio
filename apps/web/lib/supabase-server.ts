import { createClient } from "@supabase/supabase-js";

export const NEWS_IMAGE_BUCKET = "bookstore-news";

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

const DEFAULT_ACCESS_CODES = {
  input: ["지관서가", "wlrhkstjrk"],
  html: ["지관서가2", "wlrhkstjrk2"],
} as const;

type WorkerRole = keyof typeof DEFAULT_ACCESS_CODES;

function accessCodes(role: WorkerRole): readonly string[] {
  const configured = process.env[role === "input" ? "INPUT_ACCESS_CODES" : "HTML_ACCESS_CODES"];
  return configured ? configured.split(",").map((value) => value.normalize("NFC").trim()).filter(Boolean) : DEFAULT_ACCESS_CODES[role];
}

export function hasWorkspaceWriteAccess(role: unknown, code: unknown) {
  if ((role !== "input" && role !== "html") || typeof code !== "string") return false;
  return accessCodes(role).includes(code.normalize("NFC").trim());
}
