// 브라우저, API Route, Supabase 변환 코드가 함께 사용하는 애플리케이션 표준 데이터 모델입니다.
// DB의 snake_case 컬럼은 API에서 이 camelCase 구조로 변환한 뒤 UI에 전달합니다.
export type WorkStatus = "draft" | "completed";

export type Bookstore = {
  id: number;
  // updatedAt은 화면 표시뿐 아니라 다른 브라우저의 변경을 덮어쓰지 않는 낙관적 잠금 값입니다.
  updatedAt: string;
  sortOrder: number;
  name: string;
  region: string;
  address: string;
  hours: string;
  phone: string;
  sns: string;
  website: string;
  introduction: string;
  contacts: LabeledValue[];
  links: LabeledLink[];
};

export type LabeledValue = {
  id: number;
  label: string;
  value: string;
};

export type LabeledLink = {
  id: number;
  label: string;
  url: string;
};

export type NewsImage = {
  id: number;
  name: string;
  originalPath: string;
  previewPath: string;
  originalUrl: string;
  url: string;
  caption: string;
};

export type NewsItem = {
  id: number;
  title: string;
  description: string;
  dates: string[];
  scheduleText: string;
  regular: boolean;
  displayLabel: string;
  deadline: string;
  place: string;
  fee: string;
  applicationInfo: string;
  applyUrl: string;
  extraFields: LabeledValue[];
  links: LabeledLink[];
  images: NewsImage[];
  includeInDigest: boolean;
};

export type Submission = {
  id: number;
  bookstoreId: number;
  month: string;
  status: WorkStatus;
  updatedAt: string;
  completedAt: string;
  publishedAt: string;
  publishedUrl: string;
  monthlyNotice: string;
  news: NewsItem[];
};

export type Workspace = {
  // Bookstore는 여러 달에 재사용되는 기본정보, Submission은 책방별·월별 소식 묶음입니다.
  bookstores: Bookstore[];
  submissions: Submission[];
};

export type EditingPresenceTarget = {
  scope: "submission" | "digest";
  month: string;
  bookstoreId?: number;
};

export type EditingPresence = {
  status: "idle" | "checking" | "owned" | "occupied" | "unavailable";
  activeRole: "input" | "html" | null;
};
