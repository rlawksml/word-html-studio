import type { NextRequest } from "next/server";

const WINDOW_MS = 10 * 60 * 1_000;
const LOCK_MS = 10 * 60 * 1_000;
const MAX_FAILURES = 5;
const attempts = new Map<string, { failures: number; windowStartedAt: number; lockedUntil: number }>();

function clientKey(request: NextRequest, role: string) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${forwarded}:${role}`;
}

function prune(now: number) {
  if (attempts.size < 500) return;
  for (const [key, value] of attempts) if (value.lockedUntil < now && value.windowStartedAt + WINDOW_MS < now) attempts.delete(key);
}

export function loginLimit(request: NextRequest, role: string) {
  const now = Date.now();
  prune(now);
  const key = clientKey(request, role);
  const entry = attempts.get(key);
  return { key, retryAfterSeconds: entry?.lockedUntil && entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1_000) : 0 };
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  const entry = !current || current.windowStartedAt + WINDOW_MS < now
    ? { failures: 0, windowStartedAt: now, lockedUntil: 0 }
    : current;
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) entry.lockedUntil = now + LOCK_MS;
  attempts.set(key, entry);
  return entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1_000) : 0;
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
