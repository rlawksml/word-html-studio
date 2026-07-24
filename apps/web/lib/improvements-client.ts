"use client";

import { responseMessage, workspaceSessionHeaders } from "@/lib/workspace-client";
import type {
  ImprovementRequest,
  ImprovementRequestType,
  ImprovementStatus,
} from "@/lib/improvement-types";

type ImprovementListResponse = {
  improvements: ImprovementRequest[];
  canManage: boolean;
};

export async function loadImprovements() {
  const response = await fetch("/api/improvements", {
    cache: "no-store",
    headers: workspaceSessionHeaders(),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "개선사항을 불러오지 못했습니다."));
  return response.json() as Promise<ImprovementListResponse>;
}

type ImprovementSubmission = {
  requestType: ImprovementRequestType;
  title: string;
  content: string;
  location: string;
  reason: string;
  website: string;
};

export async function createImprovement(submission: ImprovementSubmission) {
  const response = await fetch("/api/improvements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "개선사항을 접수하지 못했습니다."));
  return response.json() as Promise<{ improvement: ImprovementRequest | null }>;
}

export async function updateImprovement(
  improvement: ImprovementRequest,
  status: ImprovementStatus,
  targetDate: string,
) {
  const response = await fetch("/api/improvements", {
    method: "PUT",
    headers: { "content-type": "application/json", ...workspaceSessionHeaders() },
    body: JSON.stringify({
      id: improvement.id,
      status,
      targetDate,
      updatedAt: improvement.updatedAt,
    }),
  });
  if (!response.ok) throw new Error(await responseMessage(response, "개선사항 상태를 저장하지 못했습니다."));
  return response.json() as Promise<{ improvement: ImprovementRequest }>;
}
