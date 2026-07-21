import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, PREVIEW_IMAGE_BUCKET, SupabaseConfigurationError } from "@/lib/supabase-server";
import { readWorkerSession } from "@/lib/workspace-session";
import type { Bookstore, LabeledLink, LabeledValue, NewsImage, NewsItem, Submission, Workspace } from "@/lib/workspace-types";

type BookstoreRow = {
  id: number;
  name: string;
  region: string;
  address: string;
  hours: string;
  phone: string;
  sns: string;
  website: string;
  introduction: string;
  contacts: LabeledValue[] | null;
  links: LabeledLink[] | null;
};

type SubmissionRow = {
  id: number;
  bookstore_id: number;
  month: string;
  status: "draft" | "completed";
  updated_at: string;
  completed_at: string | null;
  published_at: string | null;
  published_url: string;
  monthly_notice: string;
  news: NewsItem[];
};

function publicImageUrl(path: string) {
  if (!path) return "";
  return getSupabaseAdmin().storage.from(PREVIEW_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

function hydrateImage(image: Partial<NewsImage>, role: "input" | "html" | null): NewsImage {
  const originalPath = role ? image.originalPath || "" : "";
  const previewPath = image.previewPath || "";
  return {
    id: Number(image.id),
    name: image.name || "image.jpg",
    originalPath,
    previewPath,
    originalUrl: role === "html" && originalPath ? `/api/images?path=${encodeURIComponent(originalPath)}` : "",
    url: publicImageUrl(previewPath || originalPath),
    caption: image.caption || "",
  };
}

function sanitizeNews(news: NewsItem[]) {
  return news.map((item) => ({
    ...item,
    images: item.images.map((image) => ({
      id: image.id,
      name: image.name,
      originalPath: image.originalPath,
      previewPath: image.previewPath,
      caption: image.caption,
    })),
  }));
}

function mapBookstore(row: BookstoreRow): Bookstore {
  return { ...row, contacts: row.contacts || [], links: row.links || [] };
}

function normalizeNews(item: NewsItem, role: "input" | "html" | null): NewsItem {
  return {
    ...item,
    scheduleText: item.scheduleText || "",
    displayLabel: item.displayLabel || "",
    applicationInfo: item.applicationInfo || "",
    extraFields: item.extraFields || [],
    links: item.links || [],
    images: (item.images || []).map((image) => hydrateImage(image, role)),
  };
}

function mapSubmission(row: SubmissionRow, role: "input" | "html" | null): Submission {
  return {
    id: Number(row.id),
    bookstoreId: Number(row.bookstore_id),
    month: row.month,
    status: row.status,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || "",
    publishedAt: row.published_at || "",
    publishedUrl: row.published_url || "",
    monthlyNotice: row.monthly_notice || "",
    news: (row.news || []).map((item) => normalizeNews(item, role)),
  };
}

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

export async function GET(request: NextRequest) {
  try {
    const role = await readWorkerSession(request);
    const supabase = getSupabaseAdmin();
    const [bookstoresResult, submissionsResult] = await Promise.all([
      supabase.from("bookstores").select("id,name,region,address,hours,phone,sns,website,introduction,contacts,links").order("sort_order"),
      supabase.from("submissions").select("id,bookstore_id,month,status,updated_at,completed_at,published_at,published_url,monthly_notice,news").order("updated_at"),
    ]);
    if (bookstoresResult.error) throw bookstoresResult.error;
    if (submissionsResult.error) throw submissionsResult.error;
    return NextResponse.json({
      bookstores: (bookstoresResult.data || []).map((row) => mapBookstore(row as BookstoreRow)),
      submissions: (submissionsResult.data || []).map((row) => mapSubmission(row as SubmissionRow, role)),
    } satisfies Workspace);
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("workspace load failed", error);
    return NextResponse.json({ error: "공용 저장소에서 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}

async function save(request: NextRequest) {
  try {
    const body = await request.json() as Workspace & { sessionId?: string };
    if (!await readWorkerSession(request, request.headers.get("x-workspace-session-id") || body.sessionId || "")) return NextResponse.json({ error: "작업자 세션이 만료되었습니다." }, { status: 401 });
    if (!Array.isArray(body.bookstores) || !Array.isArray(body.submissions)) return NextResponse.json({ error: "저장할 데이터 형식이 올바르지 않습니다." }, { status: 400 });

    const payload = {
      bookstores: body.bookstores.map((bookstore, sortOrder) => ({ ...bookstore, contacts: bookstore.contacts || [], links: bookstore.links || [], sort_order: sortOrder })),
      submissions: body.submissions.map((submission) => ({
        id: submission.id,
        bookstore_id: submission.bookstoreId,
        month: submission.month,
        status: submission.status,
        updated_at: submission.updatedAt,
        completed_at: submission.completedAt || null,
        published_at: submission.publishedAt || null,
        published_url: submission.publishedUrl,
        monthly_notice: submission.monthlyNotice || "",
        news: sanitizeNews(submission.news),
      })),
    };
    const { error } = await getSupabaseAdmin().rpc("replace_bookstore_news_workspace", { payload });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("workspace save failed", error);
    return NextResponse.json({ error: "공용 저장소에 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return save(request);
}

export async function POST(request: NextRequest) {
  return save(request);
}
