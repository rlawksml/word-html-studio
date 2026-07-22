import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, SupabaseConfigurationError } from "@/lib/supabase-server";
import { BOOKSTORE_SELECT, mapBookstore, type BookstoreRow } from "@/lib/workspace-records";
import { readWorkerSession } from "@/lib/workspace-session";
import { parseBookstore, readWorkspaceJson, WorkspaceValidationError } from "@/lib/workspace-validation";

function configurationResponse() {
  return NextResponse.json({ error: "공용 저장소 연결 정보가 필요합니다." }, { status: 503 });
}

async function latestBookstore(id: number) {
  const result = await getSupabaseAdmin().from("bookstores").select(BOOKSTORE_SELECT).eq("id", id).maybeSingle();
  return result.data ? mapBookstore(result.data as BookstoreRow) : null;
}

// 책방 하나만 저장하고 updated_at이 일치할 때만 수정해 다른 브라우저의 변경을 덮어쓰지 않습니다.
export async function PUT(request: NextRequest) {
  try {
    const body = await readWorkspaceJson(request) as { bookstore?: unknown; sessionId?: unknown };
    if (await readWorkerSession(request, request.headers.get("x-workspace-session-id") || (typeof body.sessionId === "string" ? body.sessionId : "")) !== "input") {
      return NextResponse.json({ error: "책방 정보 수정 권한을 다시 확인해 주세요." }, { status: 403 });
    }
    const bookstore = parseBookstore(body.bookstore);
    const savedAt = new Date().toISOString();
    const values = {
      id: bookstore.id,
      name: bookstore.name,
      region: bookstore.region,
      address: bookstore.address,
      hours: bookstore.hours,
      phone: bookstore.phone,
      sns: bookstore.sns,
      website: bookstore.website,
      introduction: bookstore.introduction,
      contacts: bookstore.contacts,
      links: bookstore.links,
      sort_order: bookstore.sortOrder,
      updated_at: savedAt,
    };
    const query = bookstore.updatedAt
      ? getSupabaseAdmin().from("bookstores").update(values).eq("id", bookstore.id).eq("updated_at", bookstore.updatedAt)
      : getSupabaseAdmin().from("bookstores").insert(values);
    const result = await query.select(BOOKSTORE_SELECT).maybeSingle();
    if (result.error) {
      if (result.error.code === "23505") return NextResponse.json({ error: "다른 작업자가 같은 책방을 먼저 등록했습니다.", code: "WORKSPACE_CONFLICT", latest: await latestBookstore(bookstore.id) }, { status: 409 });
      throw result.error;
    }
    if (!result.data) return NextResponse.json({ error: "다른 작업자가 책방 정보를 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.", code: "WORKSPACE_CONFLICT", latest: await latestBookstore(bookstore.id) }, { status: 409 });
    return NextResponse.json({ bookstore: mapBookstore(result.data as BookstoreRow) });
  } catch (error) {
    if (error instanceof WorkspaceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SupabaseConfigurationError) return configurationResponse();
    console.error("bookstore save failed", error);
    return NextResponse.json({ error: "책방 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
