import type { Bookstore, Submission, Workspace } from "@/lib/workspace-types";

export function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function workspaceSessionHeaders() {
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
  const payload = new Blob([JSON.stringify({ bookstores, submissions, sessionId: window.sessionStorage.getItem("bookstore-news-session-id") || "" })], { type: "application/json" });
  navigator.sendBeacon("/api/workspace", payload);
}

export async function createImagePreview(file: File) {
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
