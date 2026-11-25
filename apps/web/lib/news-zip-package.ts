import { generatedHtml } from "@/lib/html-generators";
import { escapeHtml, newsImageFilename, safeFilename } from "@/lib/workspace-formatters";
import type { Bookstore, Submission } from "@/lib/workspace-types";

export type NewsZipPhoto = { name: string; url: string };
export type NewsZipDocument = { name: string; content: string };
export type NewsZipPlan = { filename: string; photoFolder: string; photos: NewsZipPhoto[]; documents: NewsZipDocument[] };

const documentEntry = (name: string, content: string): NewsZipDocument => ({ name, content });

/** HTML 편집자용 ZIP에 들어갈 파일 이름과 내용을 정합니다. 사진 내려받기와 압축은 호출하는 쪽이 맡습니다. */
export function newsZipPlan(submission: Submission, bookstore: Bookstore, withHtml: boolean): NewsZipPlan {
  const baseFilename = `${submission.month}_${safeFilename(bookstore.name)}`;
  // 비공개 원본이 있으면 원본을, 없으면 공개 미리보기를 사용자가 정한 순서대로 담습니다.
  const photos = submission.news.flatMap((news, newsIndex) => news.images.map((image, imageIndex) => ({
    name: newsImageFilename(submission.month, bookstore.name, newsIndex, imageIndex, news.title, image.name),
    url: image.originalUrl || image.url,
  })));
  const documents: NewsZipDocument[] = [];
  if (withHtml) {
    const pasteReadyHtml = generatedHtml(submission, bookstore, false);
    // HTML은 브라우저 미리보기용 전체 문서, TXT는 외부 HTML 편집기에 그대로 붙여넣는 본문 마크업입니다.
    documents.push(
      documentEntry(`${baseFilename}.html`, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(bookstore.name)}</title></head><body>${pasteReadyHtml}</body></html>`),
      documentEntry(`${baseFilename}_HTML코드_복사용.txt`, pasteReadyHtml),
      documentEntry("사진배치안내.txt", submission.news.map((news, index) => `${index + 1}. ${news.title}\n${news.images.map((image, imageIndex) => `- ${newsImageFilename(submission.month, bookstore.name, index, imageIndex, news.title, image.name)}`).join("\n")}`).join("\n\n")),
    );
  }
  return { filename: `${baseFilename}_${withHtml ? "작업파일" : "사진"}.zip`, photoFolder: "사진", photos, documents };
}
