import type { NewsImage, Submission } from "./workspace-types";

export type ImageCleanupRetentionResult = {
  retained: true;
  deleted: false;
  code: "IMAGE_CLEANUP_DEFERRED";
};

export function retainedImageCleanupResult(): ImageCleanupRetentionResult;

export function respondToDeferredImageCleanup<RequestType extends { json(): Promise<unknown> }, ReplyType>(
  request: RequestType,
  readRole: (request: RequestType) => Promise<string | null>,
  reply: (body: ImageCleanupRetentionResult | { error: string }, status: number) => ReplyType,
): Promise<ReplyType>;

export function attachUploadedImages(
  submission: Submission,
  target: { submissionId: number; bookstoreId: number; month: string; newsId: number },
  images: readonly NewsImage[],
): Submission;
