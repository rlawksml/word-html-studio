import type { NextRequest, NextResponse } from "next/server";
import { isWorkerRole, type WorkerRole } from "@/lib/supabase-server";

export const WORKSPACE_SESSION_COOKIE = "bookstore_news_session";
const SESSION_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  role: WorkerRole;
  sessionId: string;
  expiresAt: number;
};

function sessionSecret() {
  const value = process.env.WORKSPACE_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (!value) throw new Error("WORKSPACE_SESSION_SECRET 환경변수가 필요합니다.");
  return value;
}

function toBase64Url(value: Uint8Array | string) {
  const binary = typeof value === "string" ? value : Array.from(value, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(normalized);
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createWorkerSession(role: WorkerRole, sessionId: string) {
  const payload = toBase64Url(JSON.stringify({ role, sessionId, expiresAt: Date.now() + SESSION_SECONDS * 1000 } satisfies SessionPayload));
  return `${payload}.${await sign(payload)}`;
}

export async function readWorkerSession(request: NextRequest, providedSessionId = request.headers.get("x-workspace-session-id") || ""): Promise<WorkerRole | null> {
  try {
    const token = request.cookies.get(WORKSPACE_SESSION_COOKIE)?.value;
    if (!token) return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !constantTimeEqual(signature, await sign(payload))) return null;
    const parsed = JSON.parse(fromBase64Url(payload)) as Partial<SessionPayload>;
    if (!isWorkerRole(parsed.role) || typeof parsed.sessionId !== "string" || !providedSessionId || !constantTimeEqual(parsed.sessionId, providedSessionId) || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) return null;
    return parsed.role;
  } catch {
    return null;
  }
}

export function setWorkerSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(WORKSPACE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function clearWorkerSessionCookie(response: NextResponse) {
  response.cookies.set(WORKSPACE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
