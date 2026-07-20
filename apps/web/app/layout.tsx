import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "책방소식 — 동네 책방 소식 발행 도구",
  description: "책방 소식을 수집하고 검토해 개별·통합 HTML로 발행합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
