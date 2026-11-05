/**
 * #88: DB 저장 응답 유실 때 참조 여부를 확정할 수 없으므로 물리 삭제를 보류합니다.
 * retained는 이 작업이 삭제하지 않았다는 뜻이며, 파일 존재나 연결 성공의 보증이 아닙니다.
 * 이 모듈은 네트워크·Storage·DB 의존성을 받지 않으며 삭제 작업을 예약하지도 않습니다.
 */
export function retainedImageCleanupResult() {
  return { retained: true, deleted: false, code: "IMAGE_CLEANUP_DEFERRED" };
}

function validCleanupPath(value, prefix) {
  return typeof value === "string" && value.startsWith(prefix) && value.length <= 500 && !value.includes("..") && !value.includes("\\");
}

// 기존 클라이언트가 보낸 DELETE에도 권한·입력 검증을 유지하되 저장소에는 접근하지 않습니다.
export async function respondToDeferredImageCleanup(request, readRole, reply) {
  if (await readRole(request) !== "input") return reply({ error: "사진 정리 권한을 다시 확인해 주세요." }, 403);
  const body = await request.json();
  if (!Array.isArray(body?.images) || body.images.length === 0 || body.images.length > 500) {
    return reply({ error: "정리할 사진 정보가 올바르지 않습니다." }, 400);
  }
  for (const image of body.images) {
    if (!image || typeof image !== "object" || Array.isArray(image)) return reply({ error: "정리할 사진 정보가 올바르지 않습니다." }, 400);
    if (image.originalPath && !validCleanupPath(image.originalPath, "originals/")) return reply({ error: "원본 사진 경로가 올바르지 않습니다." }, 400);
    if (image.previewPath && !validCleanupPath(image.previewPath, "previews/")) return reply({ error: "미리보기 경로가 올바르지 않습니다." }, 400);
  }
  return reply(retainedImageCleanupResult(), 200);
}

// 직렬 저장 큐가 실제 transform을 실행하는 순간의 대상을 검사합니다.
// 업로드 중 소식이 제거되면 사진을 연결하지 않은 채 성공으로 알리지 않습니다.
export function attachUploadedImages(submission, target, images) {
  if (!submission || submission.id !== target.submissionId || submission.bookstoreId !== target.bookstoreId || submission.month !== target.month) {
    throw new Error("사진을 연결할 책방과 발행 월을 찾지 못했습니다. 전송된 파일은 안전을 위해 보관됩니다.");
  }
  if (!submission.news.some((news) => news.id === target.newsId)) {
    throw new Error("사진을 연결할 소식이 변경되거나 제거되었습니다. 전송된 파일은 안전을 위해 보관됩니다.");
  }
  return {
    ...submission,
    news: submission.news.map((news) => news.id === target.newsId ? { ...news, images: [...news.images, ...images] } : news),
  };
}
