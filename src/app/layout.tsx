import type { Metadata } from "next";

import { startDirectTaskWorker } from "@/lib/services/direct-tasks";

import "./globals.css";

export const metadata: Metadata = {
  title: "hema API image",
  description: "用户自带 API Key 的图片生成页",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  startDirectTaskWorker();

  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
