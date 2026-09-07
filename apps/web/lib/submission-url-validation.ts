import type { Submission } from "@/lib/workspace-types";

export type SubmissionUrlIssue = {
  code: "INVALID_URL";
  fieldPath: string;
  fieldLabel: string;
  message: string;
};

/** 외부에 공개할 링크는 http/https 주소만 허용합니다. 작성 중 문자열 자체는 별도로 보존합니다. */
export function isValidHttpUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** 일반 사용자가 www.example.com처럼 입력하면 안전한 https 주소로 한 번만 보완합니다. */
export function normalizeHttpUrlInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  if (/^(?:www\.)?(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/** 입력 완료 전에 bare domain만 보완하되, https:/ 같은 불완전 값은 사용자가 쓴 그대로 둡니다. */
export function normalizeSubmissionUrls(submission: Submission): Submission {
  return {
    ...submission,
    news: submission.news.map((news) => ({
      ...news,
      applyUrl: normalizeHttpUrlInput(news.applyUrl),
      links: news.links.map((link) => ({ ...link, url: normalizeHttpUrlInput(link.url) })),
    })),
  };
}

/** 첫 번째 잘못된 주소와 정확한 폼 위치를 반환해 UI와 API가 같은 안내를 사용하게 합니다. */
export function findInvalidSubmissionUrl(submission: Submission): SubmissionUrlIssue | null {
  for (const [newsIndex, news] of submission.news.entries()) {
    if (!isValidHttpUrl(news.applyUrl)) {
      const fieldLabel = `소식 ${newsIndex + 1} → 대표 신청 링크`;
      return {
        code: "INVALID_URL",
        fieldPath: `news.${newsIndex}.applyUrl`,
        fieldLabel,
        message: `${fieldLabel}에 http:// 또는 https://로 시작하는 주소를 입력해 주세요.`,
      };
    }
    for (const [linkIndex, link] of news.links.entries()) {
      if (!isValidHttpUrl(link.url)) {
        const fieldLabel = `소식 ${newsIndex + 1} → 관련 링크 ${linkIndex + 1}`;
        return {
          code: "INVALID_URL",
          fieldPath: `news.${newsIndex}.links.${linkIndex}.url`,
          fieldLabel,
          message: `${fieldLabel}에 http:// 또는 https://로 시작하는 주소를 입력해 주세요.`,
        };
      }
    }
  }
  return null;
}

/** 자동 저장은 부분 URL을 막지 않고, 사용자가 입력 완료를 선택한 시점에만 외부 링크를 검증합니다. */
export function findBlockingSubmissionUrl(submission: Submission) {
  return submission.status === "completed" ? findInvalidSubmissionUrl(submission) : null;
}
