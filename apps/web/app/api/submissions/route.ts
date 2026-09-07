import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, retryFutureJwt, SupabaseConfigurationError } from "@/lib/supabase-server";
import { mergeNewsPreservingUnknownFields, stripExternalNewsFields } from "@/lib/submission-json-compatibility";
import { mapSubmission, sanitizeNews, SCHEDULE_RANGE_SELECT, SUBMISSION_SELECT, type ScheduleRangeRow, type SubmissionRow } from "@/lib/workspace-records";
import { readWorkerSession } from "@/lib/workspace-session";
import { parseSubmission, readWorkspaceJson, WorkspaceValidationError } from "@/lib/workspace-validation";
import type { NewsItem, Submission } from "@/lib/workspace-types";

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

async function findSubmission(id: number) {
  const [submissionResult, rangesResult] = await Promise.all([
    retryFutureJwt(() => getSupabaseAdmin().from("submissions").select(SUBMISSION_SELECT).eq("id", id).maybeSingle()),
    retryFutureJwt(() => getSupabaseAdmin().from("news_schedule_ranges").select(SCHEDULE_RANGE_SELECT).eq("submission_id", id).eq("is_active", true)),
  ]);
  if (submissionResult.error) throw submissionResult.error;
  if (rangesResult.error) throw rangesResult.error;
  return {
    row: submissionResult.data as SubmissionRow | null,
    ranges: (rangesResult.data || []) as ScheduleRangeRow[],
  };
}

function mergeDigestSelection(existing: NewsItem[], requested: NewsItem[]) {
  const includeById = new Map(requested.map((news) => [news.id, news.includeInDigest]));
  return existing.map((news) => ({ ...news, includeInDigest: includeById.get(news.id) ?? news.includeInDigest ?? true }));
}

function conflictResponse(row: SubmissionRow | null, ranges: ScheduleRangeRow[], role: "input" | "html") {
  return NextResponse.json({
    error: "다른 작업자가 같은 소식을 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.",
    code: "WORKSPACE_CONFLICT",
    latest: row ? mapSubmission(row, role, ranges) : null,
  }, { status: 409 });
}

// 월별 소식 하나만 저장합니다. 입력자는 본문을, HTML 편집자는 발행 정보와 통합본 포함 여부만 바꿀 수 있습니다.
async function save(request: NextRequest) {
  try {
    const body = await readWorkspaceJson(request) as { submission?: unknown; sessionId?: unknown };
    const role = await readWorkerSession(request, request.headers.get("x-workspace-session-id") || (typeof body.sessionId === "string" ? body.sessionId : ""));
    if (!role) return NextResponse.json({ error: "작업자 세션이 만료되었습니다." }, { status: 401 });
    const submission = parseSubmission(body.submission);
    const existingResult = await findSubmission(submission.id);
    const existing = existingResult.row;
    if (existing && existing.updated_at !== submission.updatedAt) return conflictResponse(existing, existingResult.ranges, role);
    if (!existing && (submission.updatedAt || role !== "input")) return conflictResponse(existing, existingResult.ranges, role);

    const savedAt = new Date().toISOString();
    const publicationChanged = role === "html" && submission.publishedAt !== (existing?.published_at || "");
    const next: Submission = role === "html" && existing
      ? {
          ...mapSubmission(existing, role, existingResult.ranges),
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
    const requestedNews = sanitizeNews(next.news);
    const rawNews = body.submission && typeof body.submission === "object" && "news" in body.submission && Array.isArray(body.submission.news)
      ? body.submission.news
      : [];
    const rangeWasSent = new Set(rawNews.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, "scheduleRange")).map((item) => Number(item.id)));
    const existingRanges = new Map(existingResult.ranges.map((range) => [Number(range.news_item_id), { startDate: range.start_date, endDate: range.end_date }]));
    const requestedRanges = role === "input" ? next.news.flatMap((news) => {
      const range = rangeWasSent.has(news.id) ? news.scheduleRange : existingRanges.get(news.id);
      if (!range) return [];
      if (!Number.isSafeInteger(news.id)) throw new WorkspaceValidationError("기간을 사용하는 소식 ID가 올바르지 않습니다.", "INVALID_SCHEDULE_RANGE", "news.scheduleRange");
      return [{ news_item_id: news.id, start_date: range.startDate, end_date: range.endDate }];
    }) : [];
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
      // 기존 DB 값에만 있는 미래 버전 필드를 보존해 앱 롤백 후 저장도 무손실로 만듭니다.
      news: stripExternalNewsFields(mergeNewsPreservingUnknownFields(existing?.news, requestedNews)),
    };
    // 본문과 기간을 한 DB 트랜잭션으로 저장해 둘 중 하나만 반영되는 상태를 막습니다.
    const result = await retryFutureJwt(() => getSupabaseAdmin().rpc("save_submission_with_schedule_ranges", {
      p_submission_id: values.id,
      p_bookstore_id: values.bookstore_id,
      p_month: values.month,
      p_status: values.status,
      p_expected_updated_at: existing ? submission.updatedAt : null,
      p_updated_at: values.updated_at,
      p_completed_at: values.completed_at,
      p_published_at: values.published_at,
      p_published_url: values.published_url,
      p_monthly_notice: values.monthly_notice,
      p_news: values.news,
      p_schedule_ranges: requestedRanges,
      p_sync_ranges: role === "input",
    }).select(SUBMISSION_SELECT).maybeSingle());
    if (result.error) {
      if (result.error.code === "23505") {
        const latest = await findSubmission(next.id);
        return conflictResponse(latest.row, latest.ranges, role);
      }
      throw result.error;
    }
    if (!result.data) {
      const latest = await findSubmission(next.id);
      return conflictResponse(latest.row, latest.ranges, role);
    }
    const savedRanges = role === "input" ? requestedRanges.map((range) => ({
      submission_id: next.id,
      ...range,
      is_active: true,
    })) : existingResult.ranges;
    return NextResponse.json({ submission: mapSubmission(result.data as SubmissionRow, role, savedRanges) });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      const requestBytes = Number(request.headers.get("content-length") || 0) || null;
      // 입력 내용은 기록하지 않고 실패 유형·위치·크기만 남겨 같은 400을 운영 로그에서 구분합니다.
      console.warn("submission validation rejected", {
        code: error.code,
        fieldPath: error.fieldPath || null,
        requestBytes,
      });
      return NextResponse.json({
        error: error.message,
        message: error.message,
        code: error.code,
        fieldPath: error.fieldPath || null,
      }, { status: 400 });
    }
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
