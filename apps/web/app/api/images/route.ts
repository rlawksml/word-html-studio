import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, ORIGINAL_IMAGE_BUCKET, PREVIEW_IMAGE_BUCKET, SupabaseConfigurationError } from "@/lib/supabase-server";
import { readWorkerSession } from "@/lib/workspace-session";
import type { NewsImage } from "@/lib/workspace-types";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

type ImageUploadRequest = {
  name?: string;
  type?: string;
  size?: number;
  previewSize?: number;
  month?: string;
  bookstoreId?: number;
  newsId?: number;
};

// 사용자 파일명과 폼 값을 Storage 경로에 안전한 한 구간으로 제한합니다.
function safeSegment(value: string) {
  return value.normalize("NFC").replace(/[^0-9A-Za-z가-힣._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "image";
}

function validStoragePath(value: unknown, prefix: "originals/" | "previews/") {
  return typeof value === "string" && value.startsWith(prefix) && value.length <= 500 && !value.includes("..") && !value.includes("\\");
}

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

export async function POST(request: NextRequest) {
  try {
    // 큰 파일이 GPT 임시 서버의 본문 제한을 통과하지 않도록, 입력자에게 Storage 직접 업로드용 서명 URL만 발급합니다.
    if (await readWorkerSession(request) !== "input") return NextResponse.json({ error: "사진 업로드 권한을 다시 확인해 주세요." }, { status: 403 });
    const body = await request.json() as ImageUploadRequest;
    const originalSize = Number(body.size || 0);
    const previewSize = Number(body.previewSize || 0);
    if (!body.name || body.name.length > 255 || !body.type || !ALLOWED_IMAGE_TYPES.has(body.type) || !Number.isFinite(originalSize) || originalSize <= 0 || !Number.isFinite(previewSize) || previewSize <= 0) {
      return NextResponse.json({ error: "올바른 이미지 파일을 선택해 주세요." }, { status: 400 });
    }
    if (originalSize > MAX_IMAGE_BYTES) return NextResponse.json({ error: "사진 한 장은 20MB 이하로 업로드해 주세요." }, { status: 413 });
    if (previewSize > MAX_PREVIEW_BYTES) return NextResponse.json({ error: "사진 미리보기를 3MB 이하로 만들어 주세요." }, { status: 413 });

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.month || "")) || !Number.isSafeInteger(Number(body.bookstoreId)) || Number(body.bookstoreId) <= 0 || !Number.isFinite(Number(body.newsId)) || Number(body.newsId) <= 0) {
      return NextResponse.json({ error: "사진을 연결할 책방과 발행 월을 확인해 주세요." }, { status: 400 });
    }
    const month = safeSegment(String(body.month));
    const bookstoreId = safeSegment(String(body.bookstoreId));
    const newsId = safeSegment(String(body.newsId));
    const uniqueId = crypto.randomUUID();
    const originalName = safeSegment(body.name);
    const originalPath = `originals/${month}/${bookstoreId}/${newsId}/${uniqueId}-${originalName}`;
    const previewPath = `previews/${month}/${bookstoreId}/${newsId}/${uniqueId}.jpg`;
    const supabase = getSupabaseAdmin();
    const [originalUpload, previewUpload] = await Promise.all([
      supabase.storage.from(ORIGINAL_IMAGE_BUCKET).createSignedUploadUrl(originalPath),
      supabase.storage.from(PREVIEW_IMAGE_BUCKET).createSignedUploadUrl(previewPath),
    ]);
    if (originalUpload.error) throw originalUpload.error;
    if (previewUpload.error) throw previewUpload.error;
    const image: NewsImage = {
      id: Date.now() + Math.random(),
      name: body.name,
      originalPath,
      previewPath,
      originalUrl: "",
      url: supabase.storage.from(PREVIEW_IMAGE_BUCKET).getPublicUrl(previewPath).data.publicUrl,
      caption: "",
    };
    // 서명 URL은 2시간만 유효하며 Workspace에는 저장하지 않습니다.
    return NextResponse.json({
      image,
      uploads: {
        originalUrl: originalUpload.data.signedUrl,
        previewUrl: previewUpload.data.signedUrl,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("image upload failed", error);
    return NextResponse.json({ error: "사진을 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 소식에서 사진을 제거하면 원본과 미리보기 파일을 함께 정리합니다.
    if (await readWorkerSession(request) !== "input") return NextResponse.json({ error: "사진 삭제 권한을 다시 확인해 주세요." }, { status: 403 });
    const body = await request.json() as { images?: Array<{ originalPath?: unknown; previewPath?: unknown }> };
    if (!Array.isArray(body.images) || body.images.length === 0 || body.images.length > 500) return NextResponse.json({ error: "삭제할 사진 정보가 올바르지 않습니다." }, { status: 400 });
    const originals: string[] = [];
    const previews: string[] = [];
    for (const image of body.images) {
      if (image.originalPath) {
        if (!validStoragePath(image.originalPath, "originals/")) return NextResponse.json({ error: "원본 사진 경로가 올바르지 않습니다." }, { status: 400 });
        originals.push(image.originalPath);
      }
      if (image.previewPath) {
        if (!validStoragePath(image.previewPath, "previews/")) return NextResponse.json({ error: "미리보기 경로가 올바르지 않습니다." }, { status: 400 });
        previews.push(image.previewPath);
      }
    }
    const supabase = getSupabaseAdmin();
    const [originalResult, previewResult] = await Promise.all([
      originals.length ? supabase.storage.from(ORIGINAL_IMAGE_BUCKET).remove(originals) : Promise.resolve({ error: null }),
      previews.length ? supabase.storage.from(PREVIEW_IMAGE_BUCKET).remove(previews) : Promise.resolve({ error: null }),
    ]);
    if (originalResult.error) throw originalResult.error;
    if (previewResult.error) throw previewResult.error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("image delete failed", error);
    return NextResponse.json({ error: "사진을 삭제하지 못했습니다." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // 비공개 원본은 HTML 편집자 세션을 검증한 뒤 ZIP 다운로드용으로만 중계합니다.
    if (await readWorkerSession(request) !== "html") return NextResponse.json({ error: "원본 사진 다운로드 권한이 필요합니다." }, { status: 403 });
    const path = request.nextUrl.searchParams.get("path");
    if (!validStoragePath(path, "originals/")) return NextResponse.json({ error: "원본 사진 경로가 올바르지 않습니다." }, { status: 400 });
    const { data, error } = await getSupabaseAdmin().storage.from(ORIGINAL_IMAGE_BUCKET).download(path);
    if (error) return NextResponse.json({ error: "원본 사진을 찾지 못했습니다." }, { status: 404 });
    return new NextResponse(data, { headers: { "content-type": data.type || "application/octet-stream", "cache-control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("original image download failed", error);
    return NextResponse.json({ error: "원본 사진을 내려받지 못했습니다." }, { status: 500 });
  }
}
