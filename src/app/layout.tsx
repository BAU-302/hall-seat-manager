import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import "./group-colors.css";
import "./mobile-layout.css";
import "./mobile-refresh.css";

export const metadata: Metadata = {
  title: "홀 좌석 현장 운영 시스템",
  description: "행사별 좌석 배분과 입장을 관리하는 현장 운영 도구",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
