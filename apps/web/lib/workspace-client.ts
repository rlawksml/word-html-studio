import type { Bookstore, Submission, Workspace } from "@/lib/workspace-types";

// 브라우저와 Next.js API Route 사이의 통신 경계입니다. Supabase SDK는 이 파일에서 직접 사용하지 않습니다.
export function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function workspaceSessionHeaders() {
  // HttpOnly 쿠키와 별도로 현재 탭의 sessionId를 보내 탭 종료 후 작업 권한이 재사용되지 않게 합니다.
  const sessionId = window.sessionStorage.getItem("bookstore-news-session-id") || "";
  return sessionId ? { "x-workspace-session-id": sessionId } : {};
}

export async function urlToBlob(url: string) {
  const response = await fetch(url, { headers: workspaceSessionHeaders() });
  if (!response.ok) throw new Error("사진을 내려받지 못했습니다.");
  return response.blob();
}

export async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export async function loadWorkspace(worker = false): Promise<Workspace> {
  const response = await fetch("/api/workspace", { cache: "no-store", headers: worker ? workspaceSessionHeaders() : {} });
  if (!response.ok) throw new Error(await responseMessage(response, "공용 저장소를 불러오지 못했습니다."));
  return response.json() as Promise<Workspace>;
}

export async function persistWorkspace(bookstores: Bookstore[], submissions: Submission[]) {
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({ bookstores, submissions }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "공용 저장소에 저장하지 못했습니다."));
}

export function persistWorkspaceOnUnload(bookstores: Bookstore[], submissions: Submission[]) {
  // beforeunload 중에는 일반 fetch가 취소될 수 있어 작은 JSON 저장에 sendBeacon을 사용합니다.
  const payload = new Blob([JSON.stringify({ bookstores, submissions, sessionId: window.sessionStorage.getItem("bookstore-news-session-id") || "" })], { type: "application/json" });
  navigator.sendBeacon("/api/workspace", payload);
}

export async function createImagePreview(file: File) {
  // 원본은 다운로드용으로 보존하고 방문자에게는 긴 변 1280px JPEG 미리보기를 제공합니다.
  const bitmap = await createImageBitmap(file);
  const maxSize = 1280;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("사진 미리보기를 만들 수 없습니다.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("사진 미리보기를 만들 수 없습니다.")), "image/jpeg", .82));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-preview.jpg`, { type: "image/jpeg" });
}
