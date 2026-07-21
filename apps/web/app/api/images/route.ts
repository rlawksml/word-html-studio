import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, hasWorkspaceWriteAccess, NEWS_IMAGE_BUCKET, SupabaseConfigurationError } from "@/lib/supabase-server";
import type { NewsImage } from "@/lib/workspace-types";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function safeSegment(value: string) {
  return value.normalize("NFC").replace(/[^0-9A-Za-z가-힣._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "image";
}

function allowed(request: NextRequest) {
  return hasWorkspaceWriteAccess(request.headers.get("x-workspace-role"), request.headers.get("x-workspace-code"));
}

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

export async function POST(request: NextRequest) {
  try {
    if (!allowed(request)) return NextResponse.json({ error: "사진 업로드 권한을 다시 확인해 주세요." }, { status: 403 });
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
    const originalUpload = await supabase.storage.from(NEWS_IMAGE_BUCKET).upload(originalPath, original, { contentType: original.type, upsert: false });
    if (originalUpload.error) throw originalUpload.error;
    const previewUpload = await supabase.storage.from(NEWS_IMAGE_BUCKET).upload(previewPath, preview, { contentType: "image/jpeg", upsert: false });
    if (previewUpload.error) {
      await supabase.storage.from(NEWS_IMAGE_BUCKET).remove([originalPath]);
      throw previewUpload.error;
    }
    const image: NewsImage = {
      id: Date.now() + Math.random(),
      name: original.name,
      originalPath,
      previewPath,
      originalUrl: supabase.storage.from(NEWS_IMAGE_BUCKET).getPublicUrl(originalPath).data.publicUrl,
      url: supabase.storage.from(NEWS_IMAGE_BUCKET).getPublicUrl(previewPath).data.publicUrl,
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
    if (!allowed(request)) return NextResponse.json({ error: "사진 삭제 권한을 다시 확인해 주세요." }, { status: 403 });
    const body = await request.json() as { originalPath?: string; previewPath?: string };
    const paths = [body.originalPath, body.previewPath].filter((path): path is string => Boolean(path));
    if (!paths.length) return new NextResponse(null, { status: 204 });
    const { error } = await getSupabaseAdmin().storage.from(NEWS_IMAGE_BUCKET).remove(paths);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("image delete failed", error);
    return NextResponse.json({ error: "사진을 삭제하지 못했습니다." }, { status: 500 });
  }
}
