import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, SupabaseConfigurationError } from "@/lib/supabase-server";
import { BOOKSTORE_SELECT, mapBookstore, mapSubmission, SUBMISSION_SELECT, type BookstoreRow, type SubmissionRow } from "@/lib/workspace-records";
import { readWorkerSession } from "@/lib/workspace-session";
import type { Workspace } from "@/lib/workspace-types";

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

// 전체 Workspace API는 읽기 전용입니다. 쓰기는 /api/bookstores와 /api/submissions에서 레코드별로 처리합니다.
export async function GET(request: NextRequest) {
  try {
    const role = await readWorkerSession(request);
    const supabase = getSupabaseAdmin();
    const [bookstoresResult, submissionsResult] = await Promise.all([
      supabase.from("bookstores").select(BOOKSTORE_SELECT).order("sort_order"),
      supabase.from("submissions").select(SUBMISSION_SELECT).order("updated_at"),
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
