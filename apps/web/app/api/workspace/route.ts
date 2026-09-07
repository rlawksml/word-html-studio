import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, retryFutureJwt, SupabaseConfigurationError } from "@/lib/supabase-server";
import { BOOKSTORE_SELECT, mapBookstore, mapSubmission, SCHEDULE_RANGE_SELECT, SUBMISSION_SELECT, type BookstoreRow, type ScheduleRangeRow, type SubmissionRow } from "@/lib/workspace-records";
import { readWorkerSession } from "@/lib/workspace-session";
import type { Workspace } from "@/lib/workspace-types";

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

// 전체 Workspace API는 읽기 전용입니다. 쓰기는 /api/bookstores와 /api/submissions에서 레코드별로 처리합니다.
export async function GET(request: NextRequest) {
  try {
    const role = await readWorkerSession(request);
    const [bookstoresResult, submissionsResult, scheduleRangesResult] = await Promise.all([
      retryFutureJwt(() => getSupabaseAdmin().from("bookstores").select(BOOKSTORE_SELECT).order("sort_order")),
      retryFutureJwt(() => getSupabaseAdmin().from("submissions").select(SUBMISSION_SELECT).order("updated_at")),
      retryFutureJwt(() => getSupabaseAdmin().from("news_schedule_ranges").select(SCHEDULE_RANGE_SELECT).eq("is_active", true)),
    ]);
    if (bookstoresResult.error) throw bookstoresResult.error;
    if (submissionsResult.error) throw submissionsResult.error;
    if (scheduleRangesResult.error) throw scheduleRangesResult.error;
    const ranges = (scheduleRangesResult.data || []) as ScheduleRangeRow[];
    return NextResponse.json({
      bookstores: (bookstoresResult.data || []).map((row) => mapBookstore(row as BookstoreRow)),
      submissions: (submissionsResult.data || []).map((row) => mapSubmission(row as SubmissionRow, role, ranges.filter((range) => Number(range.submission_id) === Number(row.id)))),
    } satisfies Workspace);
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("workspace load failed", error);
    return NextResponse.json({ error: "공용 저장소에서 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}
