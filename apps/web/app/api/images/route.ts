import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, ORIGINAL_IMAGE_BUCKET, PREVIEW_IMAGE_BUCKET, SupabaseConfigurationError } from "@/lib/supabase-server";
import { readWorkerSession } from "@/lib/workspace-session";
import type { NewsImage } from "@/lib/workspace-types";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// 사용자 파일명과 폼 값을 Storage 경로에 안전한 한 구간으로 제한합니다.
function safeSegment(value: string) {
  return value.normalize("NFC").replace(/[^0-9A-Za-z가-힣._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "image";
}

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

export async function POST(request: NextRequest) {
  try {
    // 입력자만 원본(비공개)과 모바일 미리보기(공개)를 한 쌍으로 업로드할 수 있습니다.
    if (await readWorkerSession(request) !== "input") return NextResponse.json({ error: "사진 업로드 권한을 다시 확인해 주세요." }, { status: 403 });
    const form = await request.formData();
    const original = form.get("original");
    const preview = form.get("preview");
    if (!(original instanceof File) || !(preview instanceof File) || !original.type.startsWith("image/") || !preview.type.startsWith("image/")) {
      return NextResponse.json({ error: "올바른 이미지 파일을 선택해 주세요." }, { status: 400 });
    }
    if (original.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "사진 한 장은 20MB 이하로 업로드해 주세요." }, { status: 413 });

    const month = safeSegment(String(form.get("month") || "unknown-month"));
    const bookstoreId = safeSegment(String(form.get("bookstoreId") || "unknown-bookstore"));
    const newsId = safeSegment(String(form.get("newsId") || "unknown-news"));
    const uniqueId = crypto.randomUUID();
    const originalName = safeSegment(original.name);
    const originalPath = `originals/${month}/${bookstoreId}/${newsId}/${uniqueId}-${originalName}`;
    const previewPath = `previews/${month}/${bookstoreId}/${newsId}/${uniqueId}.jpg`;
    const supabase = getSupabaseAdmin();
    const originalUpload = await supabase.storage.from(ORIGINAL_IMAGE_BUCKET).upload(originalPath, original, { contentType: original.type, upsert: false });
    if (originalUpload.error) throw originalUpload.error;
    const previewUpload = await supabase.storage.from(PREVIEW_IMAGE_BUCKET).upload(previewPath, preview, { contentType: "image/jpeg", cacheControl: "300", upsert: false });
    if (previewUpload.error) {
      // 두 파일 중 하나만 남지 않도록 미리보기 실패 시 먼저 올라간 원본을 되돌립니다.
      await supabase.storage.from(ORIGINAL_IMAGE_BUCKET).remove([originalPath]);
      throw previewUpload.error;
    }
    const image: NewsImage = {
      id: Date.now() + Math.random(),
      name: original.name,
      originalPath,
      previewPath,
      originalUrl: "",
      url: supabase.storage.from(PREVIEW_IMAGE_BUCKET).getPublicUrl(previewPath).data.publicUrl,
      caption: "",
    };
    return NextResponse.json(image, { status: 201 });
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
    const body = await request.json() as { originalPath?: string; previewPath?: string };
    const supabase = getSupabaseAdmin();
    const [originalResult, previewResult] = await Promise.all([
      body.originalPath ? supabase.storage.from(ORIGINAL_IMAGE_BUCKET).remove([body.originalPath]) : Promise.resolve({ error: null }),
      body.previewPath ? supabase.storage.from(PREVIEW_IMAGE_BUCKET).remove([body.previewPath]) : Promise.resolve({ error: null }),
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
    if (!path || !path.startsWith("originals/")) return NextResponse.json({ error: "원본 사진 경로가 올바르지 않습니다." }, { status: 400 });
    const { data, error } = await getSupabaseAdmin().storage.from(ORIGINAL_IMAGE_BUCKET).download(path);
    if (error) return NextResponse.json({ error: "원본 사진을 찾지 못했습니다." }, { status: 404 });
    return new NextResponse(data, { headers: { "content-type": data.type || "application/octet-stream", "cache-control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("original image download failed", error);
    return NextResponse.json({ error: "원본 사진을 내려받지 못했습니다." }, { status: 500 });
  }
}
