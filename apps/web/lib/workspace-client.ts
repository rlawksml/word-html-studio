import type { Bookstore, EditingPresenceTarget, NewsImage, Submission, Workspace } from "@/lib/workspace-types";

export const MAX_ORIGINAL_IMAGE_BYTES = 20 * 1024 * 1024;

export class WorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}

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

async function recordResponse<T>(response: Response, key: string, fallback: string) {
  const body = await response.json().catch(() => null) as ({ error?: string; code?: string } & Record<string, unknown>) | null;
  if (!response.ok) {
    const message = body?.error || fallback;
    if (response.status === 409 || body?.code === "WORKSPACE_CONFLICT") throw new WorkspaceConflictError(message);
    throw new Error(message);
  }
  if (!body || !(key in body)) throw new Error(fallback);
  return body[key] as T;
}

export async function persistBookstore(bookstore: Bookstore) {
  const response = await fetch("/api/bookstores", {
    method: "PUT",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({ bookstore }),
  });
  return recordResponse<Bookstore>(response, "bookstore", "책방 정보를 저장하지 못했습니다.");
}

export async function persistSubmission(submission: Submission) {
  const response = await fetch("/api/submissions", {
    method: "PUT",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({ submission }),
  });
  return recordResponse<Submission>(response, "submission", "소식을 저장하지 못했습니다.");
}

export async function heartbeatEditingPresence(target: EditingPresenceTarget) {
  const response = await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify(target),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await responseMessage(response, "편집 상태를 확인하지 못했습니다."));
  return response.json() as Promise<{ owned: boolean; activeRole: "input" | "html"; expiresAt: string }>;
}

export function releaseEditingPresence(target: EditingPresenceTarget) {
  const sessionId = window.sessionStorage.getItem("bookstore-news-session-id") || "";
  return fetch("/api/presence", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({ ...target, sessionId }),
    keepalive: true,
  });
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
  const storageError = await response.json().catch(() => null) as { statusCode?: string | number; error?: string; message?: string } | null;
  const errorText = `${storageError?.error || ""} ${storageError?.message || ""}`.toLowerCase();
  // Chrome가 완료된 PUT 응답을 놓쳐 같은 서명 URL을 다시 보내면 Storage는 HTTP 400 안에
  // 실제 409 Duplicate를 담아 돌려줍니다. 경로는 예약마다 UUID로 만들어지므로 이 경우 파일은 이미 안전하게 저장됐습니다.
  if (
    (response.status === 400 || response.status === 409)
    && (String(storageError?.statusCode) === "409" || errorText.includes("duplicate") || errorText.includes("already exists"))
  ) return;
  if (response.status === 413) throw new Error(`${file.name}: 사진 용량이 저장소의 허용 범위를 넘었습니다. 20MB 이하 사진을 사용해 주세요.`);
  if (response.status === 400 && (errorText.includes("mime") || errorText.includes("content type"))) {
    throw new Error(`${file.name}: 지원하지 않는 사진 형식입니다. JPG, PNG, WEBP, GIF 또는 HEIC 파일을 사용해 주세요.`);
  }
  throw new Error(`${file.name}: 사진 파일을 저장하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요. (${response.status})`);
}

export function persistSubmissionOnUnload(submission: Submission) {
  // 이탈 중에는 현재 편집 중인 소식 하나만 보내 전체 Workspace 덮어쓰기를 피합니다.
  const payload = new Blob([JSON.stringify({ submission, sessionId: window.sessionStorage.getItem("bookstore-news-session-id") || "" })], { type: "application/json" });
  navigator.sendBeacon("/api/submissions", payload);
}

export async function deleteStoredImages(images: NewsImage[]) {
  const targets = images.filter((image) => image.originalPath || image.previewPath);
  if (!targets.length) return;
  const response = await fetch("/api/images", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({ images: targets.map(({ originalPath, previewPath }) => ({ originalPath, previewPath })) }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "사진 파일을 정리하지 못했습니다."));
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
