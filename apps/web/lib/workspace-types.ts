export type WorkStatus = "draft" | "completed";

export type Bookstore = {
  id: number;
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
  bookstores: Bookstore[];
  submissions: Submission[];
};
