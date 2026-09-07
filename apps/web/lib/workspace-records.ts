import { getSupabaseAdmin, PREVIEW_IMAGE_BUCKET } from "@/lib/supabase-server";
import type { Bookstore, LabeledLink, LabeledValue, NewsImage, NewsItem, NewsScheduleRange, Submission } from "@/lib/workspace-types";

export const BOOKSTORE_SELECT = "id,updated_at,sort_order,name,region,address,hours,phone,sns,website,introduction,contacts,links";
export const SUBMISSION_SELECT = "id,bookstore_id,month,status,updated_at,completed_at,published_at,published_url,monthly_notice,news";
export const SCHEDULE_RANGE_SELECT = "submission_id,news_item_id,start_date,end_date,is_active";

export type BookstoreRow = {
  id: number;
  updated_at: string;
  sort_order: number;
  name: string;
  region: string;
  address: string;
  hours: string;
  phone: string;
  sns: string;
  website: string;
  introduction: string;
  contacts: LabeledValue[] | null;
  links: LabeledLink[] | null;
};

export type SubmissionRow = {
  id: number;
  bookstore_id: number;
  month: string;
  status: "draft" | "completed";
  updated_at: string;
  completed_at: string | null;
  published_at: string | null;
  published_url: string;
  monthly_notice: string;
  news: NewsItem[];
};

export type ScheduleRangeRow = {
  submission_id: number;
  news_item_id: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
};

function publicImageUrl(path: string) {
  if (!path) return "";
  return getSupabaseAdmin().storage.from(PREVIEW_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

function hydrateImage(image: Partial<NewsImage>, role: "input" | "html" | null): NewsImage {
  const originalPath = role ? image.originalPath || "" : "";
  const previewPath = image.previewPath || "";
  return {
    id: Number(image.id),
    name: image.name || "image.jpg",
    originalPath,
    previewPath,
    originalUrl: role === "html" && originalPath ? `/api/images?path=${encodeURIComponent(originalPath)}` : "",
    url: publicImageUrl(previewPath || originalPath),
    caption: image.caption || "",
  };
}

export function sanitizeNews(news: NewsItem[]) {
  return news.map((item) => {
    // scheduleRange는 롤백 호환성을 위해 JSONB가 아닌 news_schedule_ranges에만 저장합니다.
    const jsonItem = { ...item } as Partial<NewsItem>;
    delete jsonItem.scheduleRange;
    return {
    ...jsonItem,
    images: item.images.map((image) => ({
      id: image.id,
      name: image.name,
      originalPath: image.originalPath,
      previewPath: image.previewPath,
      caption: image.caption,
    })),
  };
  });
}

export function mapBookstore(row: BookstoreRow): Bookstore {
  return {
    id: Number(row.id),
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    name: row.name,
    region: row.region,
    address: row.address,
    hours: row.hours,
    phone: row.phone,
    sns: row.sns,
    website: row.website,
    introduction: row.introduction,
    contacts: row.contacts || [],
    links: row.links || [],
  };
}

function normalizeNews(item: NewsItem, role: "input" | "html" | null, scheduleRange: NewsScheduleRange | null): NewsItem {
  return {
    ...item,
    scheduleRange,
    scheduleText: item.scheduleText || "",
    displayLabel: item.displayLabel || "",
    applicationInfo: item.applicationInfo || "",
    extraFields: item.extraFields || [],
    links: item.links || [],
    images: (item.images || []).map((image) => hydrateImage(image, role)),
  };
}

export function mapSubmission(row: SubmissionRow, role: "input" | "html" | null, ranges: ScheduleRangeRow[] = []): Submission {
  const rangesByNewsId = new Map(ranges.filter((range) => range.is_active).map((range) => [Number(range.news_item_id), {
    startDate: range.start_date,
    endDate: range.end_date,
  }]));
  return {
    id: Number(row.id),
    bookstoreId: Number(row.bookstore_id),
    month: row.month,
    status: row.status,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || "",
    publishedAt: row.published_at || "",
    publishedUrl: row.published_url || "",
    monthlyNotice: row.monthly_notice || "",
    news: (row.news || []).map((item) => normalizeNews(item, role, rangesByNewsId.get(Number(item.id)) || null)),
  };
}
