import type { Submission } from "@/lib/workspace-types";

const DRAFT_VERSION = 1;
const DRAFT_PREFIX = "bookstore-news-draft:";

type StoredSubmissionDraft = {
  version: number;
  savedAt: string;
  submission: Submission;
};

function draftKey(month: string, bookstoreId: number) {
  return `${DRAFT_PREFIX}${month}:${bookstoreId}`;
}

function isSubmission(value: unknown): value is Submission {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Submission>;
  return Number.isSafeInteger(item.id)
    && Number.isSafeInteger(item.bookstoreId)
    && typeof item.month === "string"
    && (item.status === "draft" || item.status === "completed")
    && typeof item.updatedAt === "string"
    && Array.isArray(item.news);
}

/**
 * Supabase가 최종 저장소지만, 입력 직후 탭 이동·새로고침이 일어나도 마지막 키 입력을 잃지 않도록
 * 현재 탭에 작은 복구본을 동기 저장합니다. 탭을 닫으면 sessionStorage와 함께 사라집니다.
 */
export function rememberSubmissionDraft(submission: Submission, storage: Storage = window.sessionStorage) {
  const payload: StoredSubmissionDraft = {
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    submission,
  };
  try {
    storage.setItem(draftKey(submission.month, submission.bookstoreId), JSON.stringify(payload));
    return true;
  } catch {
    // 사생활 보호 설정이나 저장 한도 때문에 브라우저 복구본이 막혀도 Supabase 자동 저장은 계속합니다.
    return false;
  }
}

export function recoverSubmissionDraft(serverSubmission: Submission, storage: Storage = window.sessionStorage) {
  const key = draftKey(serverSubmission.month, serverSubmission.bookstoreId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSubmissionDraft>;
    const draft = parsed.submission;
    const sameUnsavedRecord = !serverSubmission.updatedAt && !draft?.updatedAt;
    const matchesRecord = parsed.version === DRAFT_VERSION
      && typeof parsed.savedAt === "string"
      && isSubmission(draft)
      && (draft.id === serverSubmission.id || sameUnsavedRecord)
      && draft.bookstoreId === serverSubmission.bookstoreId
      && draft.month === serverSubmission.month;
    // 서버가 다른 탭에서 더 새 버전으로 바뀌었다면 오래된 복구본으로 덮지 않습니다.
    if (!matchesRecord || draft.updatedAt !== serverSubmission.updatedAt) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    try { storage.removeItem(key); } catch { /* 브라우저 저장소가 막힌 경우 복구본 없이 계속합니다. */ }
    return null;
  }
}

export function forgetSubmissionDraft(submission: Pick<Submission, "month" | "bookstoreId">, storage: Storage = window.sessionStorage) {
  try {
    storage.removeItem(draftKey(submission.month, submission.bookstoreId));
  } catch {
    // 서버 저장은 이미 끝났으므로 복구본 정리 실패가 작업 완료를 막지 않게 합니다.
  }
}
