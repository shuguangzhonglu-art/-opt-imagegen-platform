import type { Metadata } from "next";

import { ensureRuntimeSetup } from "@/lib/bootstrap";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hemora",
  description: "登录后用积分生成图片",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await ensureRuntimeSetup();

  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
