import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_SOCIAL_IMAGE, SITE_TITLE, SITE_URL } from "@/lib/site-metadata";
import "./globals.css";

// App Router 전체에 공통으로 적용되는 문서 메타데이터입니다.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_TITLE}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_TITLE,
  keywords: ["지관서가", "동네책방", "독립서점", "독서모임", "책방 행사", "지역 문화"],
  alternates: { canonical: "/" },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_TITLE,
    locale: "ko_KR",
    type: "website",
    images: [{ url: SITE_SOCIAL_IMAGE, width: 1200, height: 630, alt: "지관서가 동네책방 소식" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_SOCIAL_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#292c2a",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 역할별 화면은 StudioPage에서 교체되므로 RootLayout은 HTML 문서 골격만 담당합니다.
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
