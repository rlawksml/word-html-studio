import type { Bookstore, LabeledLink, LabeledValue, NewsImage, NewsItem, Submission } from "@/lib/workspace-types";

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, label: string, max: number, required = false) => {
  if (typeof value !== "string") throw new WorkspaceValidationError(`${label} 형식이 올바르지 않습니다.`);
  const normalized = value.normalize("NFC");
  if (required && !normalized.trim()) throw new WorkspaceValidationError(`${label}을 입력해 주세요.`);
  if (normalized.length > max) throw new WorkspaceValidationError(`${label}은 ${max.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`);
  return normalized;
};
const numericId = (value: unknown, label: string, integer = false) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isSafeInteger(parsed))) throw new WorkspaceValidationError(`${label}이 올바르지 않습니다.`);
  return parsed;
};
const iso = (value: unknown, label: string, optional = true) => {
  const parsed = text(value, label, 40);
  if (!parsed && optional) return "";
  if (!/^\d{4}-\d{2}-\d{2}T/.test(parsed) || !Number.isFinite(Date.parse(parsed))) throw new WorkspaceValidationError(`${label}이 올바르지 않습니다.`);
  return parsed;
};
const dateOnly = (value: unknown, label: string, optional = true) => {
  const parsed = text(value, label, 10);
  if (!parsed && optional) return "";
  if (!parsed) throw new WorkspaceValidationError(`${label}가 올바르지 않습니다.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parsed);
  if (!match) throw new WorkspaceValidationError(`${label}가 올바르지 않습니다.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) throw new WorkspaceValidationError(`${label}가 올바르지 않습니다.`);
  return parsed;
};
const httpUrl = (value: unknown, label: string) => {
  const parsed = text(value, label, 2_000);
  if (!parsed) return "";
  try {
    const url = new URL(parsed);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    // 검증만 하고 사용자가 입력한 표기는 유지해 서버 정규화가 불필요한 자동 저장을 반복시키지 않게 합니다.
    return parsed;
  } catch {
    throw new WorkspaceValidationError(`${label}은 http:// 또는 https://로 시작하는 주소를 입력해 주세요.`);
  }
};

function list(value: unknown, label: string, max: number) {
  if (!Array.isArray(value) || value.length > max) throw new WorkspaceValidationError(`${label} 개수가 올바르지 않습니다.`);
  return value;
}

function labeledValue(value: unknown, label: string): LabeledValue {
  if (!isObject(value)) throw new WorkspaceValidationError(`${label} 형식이 올바르지 않습니다.`);
  return { id: numericId(value.id, `${label} ID`), label: text(value.label, `${label} 이름`, 100), value: text(value.value, `${label} 내용`, 2_000) };
}

function labeledLink(value: unknown, label: string): LabeledLink {
  if (!isObject(value)) throw new WorkspaceValidationError(`${label} 형식이 올바르지 않습니다.`);
  return { id: numericId(value.id, `${label} ID`), label: text(value.label, `${label} 이름`, 100), url: httpUrl(value.url, `${label} URL`) };
}

function image(value: unknown): NewsImage {
  if (!isObject(value)) throw new WorkspaceValidationError("사진 정보가 올바르지 않습니다.");
  const originalPath = text(value.originalPath, "원본 사진 경로", 500);
  const previewPath = text(value.previewPath, "미리보기 경로", 500);
  if (originalPath && (!originalPath.startsWith("originals/") || originalPath.includes("..") || originalPath.includes("\\"))) throw new WorkspaceValidationError("원본 사진 경로가 올바르지 않습니다.");
  if (previewPath && (!previewPath.startsWith("previews/") || previewPath.includes("..") || previewPath.includes("\\"))) throw new WorkspaceValidationError("미리보기 경로가 올바르지 않습니다.");
  return {
    id: numericId(value.id, "사진 ID"),
    name: text(value.name, "사진 이름", 255, true),
    originalPath,
    previewPath,
    originalUrl: "",
    url: "",
    caption: text(value.caption, "사진 설명", 1_000),
  };
}

function newsItem(value: unknown): NewsItem {
  if (!isObject(value)) throw new WorkspaceValidationError("소식 형식이 올바르지 않습니다.");
  const dates = list(value.dates, "행사 날짜", 100).map((date) => dateOnly(date, "행사 날짜", false));
  if (typeof value.regular !== "boolean" || typeof value.includeInDigest !== "boolean") throw new WorkspaceValidationError("소식 선택값이 올바르지 않습니다.");
  return {
    id: numericId(value.id, "소식 ID"),
    title: text(value.title, "소식 제목", 300),
    description: text(value.description, "상세 내용", 30_000),
    dates,
    scheduleText: text(value.scheduleText, "일정 안내", 2_000),
    regular: value.regular,
    displayLabel: text(value.displayLabel, "표시 라벨", 100),
    deadline: dateOnly(value.deadline, "신청 마감일"),
    place: text(value.place, "장소", 1_000),
    fee: text(value.fee, "참가비", 500),
    applicationInfo: text(value.applicationInfo, "신청 방법", 3_000),
    applyUrl: httpUrl(value.applyUrl, "대표 신청 링크"),
    extraFields: list(value.extraFields, "추가 항목", 100).map((item, index) => labeledValue(item, `추가 항목 ${index + 1}`)),
    links: list(value.links, "관련 링크", 100).map((item, index) => labeledLink(item, `관련 링크 ${index + 1}`)),
    images: list(value.images, "사진", 500).map(image),
    includeInDigest: value.includeInDigest,
  };
}

export function parseBookstore(value: unknown): Bookstore {
  if (!isObject(value)) throw new WorkspaceValidationError("책방 정보가 올바르지 않습니다.");
  const sortOrder = Number(value.sortOrder);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) throw new WorkspaceValidationError("책방 순서가 올바르지 않습니다.");
  return {
    id: numericId(value.id, "책방 ID", true),
    updatedAt: iso(value.updatedAt, "책방 저장 시각"),
    sortOrder,
    name: text(value.name, "책방 이름", 200, true),
    region: text(value.region, "지역", 200, true),
    address: text(value.address, "주소", 1_000),
    hours: text(value.hours, "영업시간", 2_000),
    phone: text(value.phone, "대표 연락처", 500),
    sns: text(value.sns, "대표 SNS", 2_000),
    website: httpUrl(value.website, "홈페이지"),
    introduction: text(value.introduction, "책방 소개", 10_000),
    contacts: list(value.contacts, "추가 연락처", 100).map((item, index) => labeledValue(item, `추가 연락처 ${index + 1}`)),
    links: list(value.links, "추가 링크", 100).map((item, index) => labeledLink(item, `추가 링크 ${index + 1}`)),
  };
}

export function parseSubmission(value: unknown): Submission {
  if (!isObject(value)) throw new WorkspaceValidationError("소식 정보가 올바르지 않습니다.");
  const month = text(value.month, "발행 월", 7, true);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new WorkspaceValidationError("발행 월이 올바르지 않습니다.");
  if (value.status !== "draft" && value.status !== "completed") throw new WorkspaceValidationError("작업 상태가 올바르지 않습니다.");
  return {
    id: numericId(value.id, "소식 묶음 ID", true),
    bookstoreId: numericId(value.bookstoreId, "책방 ID", true),
    month,
    status: value.status,
    updatedAt: iso(value.updatedAt, "소식 저장 시각"),
    completedAt: iso(value.completedAt, "입력 완료 시각"),
    publishedAt: iso(value.publishedAt, "게시 완료 시각"),
    publishedUrl: httpUrl(value.publishedUrl, "게시 URL"),
    monthlyNotice: text(value.monthlyNotice, "이번 달 운영 안내", 10_000),
    news: list(value.news, "소식", 100).map(newsItem),
  };
}

export async function readWorkspaceJson(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_REQUEST_BYTES) throw new WorkspaceValidationError("한 번에 저장할 내용이 너무 큽니다.");
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new WorkspaceValidationError("한 번에 저장할 내용이 너무 큽니다.");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof WorkspaceValidationError) throw error;
    throw new WorkspaceValidationError("요청 내용을 읽지 못했습니다.");
  }
}
