import type { Bookstore, NewsImage, Submission, Workspace } from "@/lib/workspace-types";

export const MAX_ORIGINAL_IMAGE_BYTES = 20 * 1024 * 1024;

type ImageUploadReservation = {
  image: NewsImage;
  uploads: {
    originalUrl: string;
    previewUrl: string;
  };
};

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

export async function loadWorkspace(worker = false, signal?: AbortSignal): Promise<Workspace> {
  const response = await fetch("/api/workspace", { cache: "no-store", headers: worker ? workspaceSessionHeaders() : {}, signal });
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

export async function reserveImageUpload(file: File, preview: File, month: string, bookstoreId: number, newsId: number) {
  // 파일 자체는 보내지 않고, 짧게 유효한 Supabase Storage 업로드 주소만 서버에서 발급받습니다.
  const response = await fetch("/api/images", {
    method: "POST",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({
      name: file.name,
      type: file.type,
      size: file.size,
      previewSize: preview.size,
      month,
      bookstoreId,
      newsId,
    }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "사진 업로드를 준비하지 못했습니다."));
  return response.json() as Promise<ImageUploadReservation>;
}

export async function uploadFileToSignedUrl(signedUrl: string, file: File, cacheControl: string) {
  // 큰 원본이 Next.js/GPT 임시 서버의 요청 크기 제한에 걸리지 않도록 Storage로 바로 전송합니다.
  const form = new FormData();
  form.append("cacheControl", cacheControl);
  form.append("", file);
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: form,
  });
  if (response.ok) return;
  if (response.status === 413) throw new Error(`${file.name}: 사진 용량이 저장소의 허용 범위를 넘었습니다. 20MB 이하 사진을 사용해 주세요.`);
  throw new Error(`${file.name}: 사진 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.`);
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
