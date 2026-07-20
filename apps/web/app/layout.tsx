import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "지관서가 동네책방 소식",
  description: "동네책방의 월간 소식을 달력으로 보고, 입력부터 HTML 발행까지 한곳에서 관리합니다.",
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
