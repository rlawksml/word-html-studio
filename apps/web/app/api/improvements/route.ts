import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, SupabaseConfigurationError } from "@/lib/supabase-server";
import {
  IMPROVEMENT_STATUSES,
  isImprovementRequestType,
  isImprovementStatus,
  type ImprovementRequest,
  type ImprovementRequestType,
  type ImprovementStatus,
} from "@/lib/improvement-types";
import { readWorkerSession } from "@/lib/workspace-session";
import { readWorkspaceJson, WorkspaceValidationError } from "@/lib/workspace-validation";

const IMPROVEMENT_SELECT = "id,request_type,title,content,location,reason,status,target_date,created_at,updated_at,resolved_at";

type ImprovementRow = {
  id: string;
  request_type: ImprovementRequestType;
  title: string;
  content: string;
  location: string | null;
  reason: string | null;
  status: ImprovementStatus;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

function mapImprovement(row: ImprovementRow): ImprovementRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    title: row.title,
    content: row.content,
    location: row.location || "",
    reason: row.reason || "",
    status: row.status,
    targetDate: row.target_date || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || "",
  };
}

function text(value: unknown, label: string, max: number, min = 0) {
  if (typeof value !== "string") throw new WorkspaceValidationError(`${label} 형식이 올바르지 않습니다.`);
  const normalized = value.normalize("NFC").trim();
  if (normalized.length < min) throw new WorkspaceValidationError(`${label}을 ${min}자 이상 입력해 주세요.`);
  if (normalized.length > max) throw new WorkspaceValidationError(`${label}은 ${max.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`);
  return normalized;
}

function dateOnly(value: unknown) {
  const normalized = text(value, "예정일", 10);
  if (!normalized) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new WorkspaceValidationError("예정일 형식이 올바르지 않습니다.");
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3])) {
    throw new WorkspaceValidationError("예정일 형식이 올바르지 않습니다.");
  }
  return normalized;
}

function configurationResponse() {
  return NextResponse.json({ error: "개선사항 저장소를 준비하지 못했습니다." }, { status: 503 });
}

// 목록은 공개하되 관리 권한은 현재 탭의 HTML 편집자 세션으로 서버에서 판별합니다.
export async function GET(request: NextRequest) {
  try {
    const result = await getSupabaseAdmin().from("improvement_requests")
      .select(IMPROVEMENT_SELECT)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    const improvements = (result.data as ImprovementRow[])
      .map(mapImprovement)
      .sort((left, right) => Number(left.status === "resolved") - Number(right.status === "resolved"));
    const workerRole = await readWorkerSession(request);
    return NextResponse.json({
      improvements,
      canManage: workerRole === "html",
    });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("improvement list failed", error);
    return NextResponse.json({ error: "개선사항을 불러오지 못했습니다." }, { status: 500 });
  }
}

// 공개 접수는 유형에 맞는 필수 항목만 받습니다. 숨은 website 필드는 자동 입력 봇의 단순 제출을 걸러냅니다.
export async function POST(request: NextRequest) {
  try {
    const body = await readWorkspaceJson(request) as {
      requestType?: unknown;
      title?: unknown;
      content?: unknown;
      location?: unknown;
      reason?: unknown;
      website?: unknown;
    };
    const website = text(body.website ?? "", "확인 항목", 200);
    if (website) return NextResponse.json({ improvement: null }, { status: 201 });
    if (!isImprovementRequestType(body.requestType)) {
      throw new WorkspaceValidationError("접수 유형은 버그 또는 개선 중에서 선택해 주세요.");
    }
    const requestType = body.requestType;
    const location = requestType === "bug" ? text(body.location, "발생 위치 또는 사용 경로", 500, 2) : "";
    const reason = requestType === "improvement" ? text(body.reason, "필요한 이유", 1_000, 2) : "";
    const now = new Date().toISOString();
    const values = {
      id: crypto.randomUUID(),
      request_type: requestType,
      title: text(body.title, "제목", 120, 2),
      content: text(body.content, "내용", 4_000, 5),
      location: location || null,
      reason: reason || null,
      status: "received" satisfies ImprovementStatus,
      target_date: null,
      created_at: now,
      updated_at: now,
      resolved_at: null,
    };
    const result = await getSupabaseAdmin().from("improvement_requests")
      .insert(values)
      .select(IMPROVEMENT_SELECT)
      .single();
    if (result.error) throw result.error;
    return NextResponse.json({ improvement: mapImprovement(result.data as ImprovementRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("improvement create failed", error);
    return NextResponse.json({ error: "개선사항을 접수하지 못했습니다." }, { status: 500 });
  }
}

// 버그와 개선사항을 처리하는 HTML 편집자만 상태와 예정일을 바꿀 수 있습니다.
export async function PUT(request: NextRequest) {
  try {
    const body = await readWorkspaceJson(request) as {
      id?: unknown;
      status?: unknown;
      targetDate?: unknown;
      updatedAt?: unknown;
    };
    const workerRole = await readWorkerSession(request);
    if (!workerRole) {
      return NextResponse.json({ error: "개선사항 관리 권한을 다시 확인해 주세요." }, { status: 401 });
    }
    if (workerRole !== "html") {
      return NextResponse.json({ error: "버그와 개선사항 상태는 HTML 편집자만 관리할 수 있습니다." }, { status: 403 });
    }
    const id = text(body.id, "개선사항 ID", 80, 20);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new WorkspaceValidationError("개선사항 ID가 올바르지 않습니다.");
    if (!isImprovementStatus(body.status)) {
      throw new WorkspaceValidationError(`상태는 ${IMPROVEMENT_STATUSES.join(", ")} 중 하나여야 합니다.`);
    }
    const updatedAt = text(body.updatedAt, "수정 시각", 40, 20);
    if (!Number.isFinite(Date.parse(updatedAt))) throw new WorkspaceValidationError("수정 시각이 올바르지 않습니다.");
    const savedAt = new Date().toISOString();
    const values = {
      status: body.status,
      target_date: dateOnly(body.targetDate) || null,
      updated_at: savedAt,
      resolved_at: body.status === "resolved" ? savedAt : null,
    };
    const result = await getSupabaseAdmin().from("improvement_requests")
      .update(values)
      .eq("id", id)
      .eq("updated_at", updatedAt)
      .select(IMPROVEMENT_SELECT)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      return NextResponse.json({ error: "다른 작업자가 먼저 상태를 변경했습니다. 목록을 새로고침해 주세요.", code: "IMPROVEMENT_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json({ improvement: mapImprovement(result.data as ImprovementRow) });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("improvement update failed", error);
    return NextResponse.json({ error: "개선사항 상태를 저장하지 못했습니다." }, { status: 500 });
  }
}
