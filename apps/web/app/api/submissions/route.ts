import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, SupabaseConfigurationError } from "@/lib/supabase-server";
import { mapSubmission, sanitizeNews, SUBMISSION_SELECT, type SubmissionRow } from "@/lib/workspace-records";
import { readWorkerSession } from "@/lib/workspace-session";
import { parseSubmission, readWorkspaceJson, WorkspaceValidationError } from "@/lib/workspace-validation";
import type { NewsItem, Submission } from "@/lib/workspace-types";

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

async function findSubmission(id: number) {
  const result = await getSupabaseAdmin().from("submissions").select(SUBMISSION_SELECT).eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  return result.data as SubmissionRow | null;
}

function mergeDigestSelection(existing: NewsItem[], requested: NewsItem[]) {
  const includeById = new Map(requested.map((news) => [news.id, news.includeInDigest]));
  return existing.map((news) => ({ ...news, includeInDigest: includeById.get(news.id) ?? news.includeInDigest ?? true }));
}

function conflictResponse(row: SubmissionRow | null, role: "input" | "html") {
  return NextResponse.json({
    error: "다른 작업자가 같은 소식을 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.",
    code: "WORKSPACE_CONFLICT",
    latest: row ? mapSubmission(row, role) : null,
  }, { status: 409 });
}

// 월별 소식 하나만 저장합니다. 입력자는 본문을, HTML 편집자는 발행 정보와 통합본 포함 여부만 바꿀 수 있습니다.
async function save(request: NextRequest) {
  try {
    const body = await readWorkspaceJson(request) as { submission?: unknown; sessionId?: unknown };
    const role = await readWorkerSession(request, request.headers.get("x-workspace-session-id") || (typeof body.sessionId === "string" ? body.sessionId : ""));
    if (!role) return NextResponse.json({ error: "작업자 세션이 만료되었습니다." }, { status: 401 });
    const submission = parseSubmission(body.submission);
    const existing = await findSubmission(submission.id);
    if (existing && existing.updated_at !== submission.updatedAt) return conflictResponse(existing, role);
    if (!existing && (submission.updatedAt || role !== "input")) return conflictResponse(existing, role);

    const savedAt = new Date().toISOString();
    const publicationChanged = role === "html" && submission.publishedAt !== (existing?.published_at || "");
    const next: Submission = role === "html" && existing
      ? {
          ...mapSubmission(existing, role),
          updatedAt: savedAt,
          publishedAt: publicationChanged && submission.publishedAt ? savedAt : submission.publishedAt,
          publishedUrl: submission.publishedUrl,
          news: mergeDigestSelection(existing.news || [], submission.news),
        }
      : {
          ...submission,
          updatedAt: savedAt,
          publishedAt: existing?.published_at || submission.publishedAt,
          publishedUrl: existing?.published_url || submission.publishedUrl,
        };
    const values = {
      id: next.id,
      bookstore_id: next.bookstoreId,
      month: next.month,
      status: next.status,
      updated_at: next.updatedAt,
      completed_at: next.completedAt || null,
      published_at: next.publishedAt || null,
      published_url: next.publishedUrl,
      monthly_notice: next.monthlyNotice,
      news: sanitizeNews(next.news),
    };
    const query = existing
      ? getSupabaseAdmin().from("submissions").update(values).eq("id", next.id).eq("updated_at", submission.updatedAt)
      : getSupabaseAdmin().from("submissions").insert(values);
    const result = await query.select(SUBMISSION_SELECT).maybeSingle();
    if (result.error) {
      if (result.error.code === "23505") return conflictResponse(await findSubmission(next.id), role);
      throw result.error;
    }
    if (!result.data) return conflictResponse(await findSubmission(next.id), role);
    return NextResponse.json({ submission: mapSubmission(result.data as SubmissionRow, role) });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("submission save failed", error);
    return NextResponse.json({ error: "소식을 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return save(request);
}

// beforeunload 중 sendBeacon으로 전달된 현재 소식도 같은 충돌 검사와 검증을 통과합니다.
export async function POST(request: NextRequest) {
  return save(request);
}
