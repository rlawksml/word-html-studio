import type { Submission } from "@/lib/workspace-types";

export class SubmissionContentMismatchError extends Error {
  constructor() {
    super("마지막 입력 내용과 서버에 저장된 내용이 일치하지 않습니다. 편집 화면에서 내용을 확인한 뒤 다시 저장해 주세요.");
    this.name = "SubmissionContentMismatchError";
  }
}

/**
 * React 렌더 클로저가 아니라 controller의 동기 ref에서 완료할 최신 소식을 선택합니다.
 * 마지막 입력 이벤트와 완료 버튼이 가까이 발생해도 이전 렌더의 본문을 저장하지 않습니다.
 */
export function buildCompletedSubmission(
  submissions: readonly Submission[],
  bookstoreId: number,
  month: string,
  completedAt: string,
) {
  const latest = submissions.find((submission) => (
    submission.bookstoreId === bookstoreId && submission.month === month
  ));
  if (!latest) throw new Error("입력을 마무리할 책방 소식을 찾지 못했습니다.");
  return { ...latest, status: "completed" as const, completedAt };
}

function normalizeText<T>(value: T): T {
  if (typeof value === "string") return value.normalize("NFC") as T;
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      // PostgreSQL JSONB는 객체 키 순서를 보존하지 않습니다. 배열 순서는 그대로 두고
      // 객체 키만 정렬해야 같은 저장 내용을 키 순서 차이로 실패 처리하지 않습니다.
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeText(item)]),
    ) as T;
  }
  return value;
}

function comparableSubmission(submission: Submission) {
  return normalizeText({
    ...submission,
    // 저장·완료·게시 시각과 표시용 서명 URL은 서버가 만들거나 ISO 표기를 바꿀 수 있어 본문 검증에서 제외합니다.
    updatedAt: "",
    completedAt: "",
    publishedAt: "",
    news: submission.news.map((news) => ({
      ...news,
      images: news.images.map((image) => ({
        ...image,
        originalUrl: "",
        url: "",
      })),
    })),
  });
}

/** 서버가 확인한 완료 응답이 제목·본문·선택 입력을 포함한 요청 스냅샷과 같은지 검증합니다. */
export function assertSubmissionContentMatches(requested: Submission, saved: Submission) {
  if (JSON.stringify(comparableSubmission(requested)) !== JSON.stringify(comparableSubmission(saved))) {
    throw new SubmissionContentMismatchError();
  }
}
