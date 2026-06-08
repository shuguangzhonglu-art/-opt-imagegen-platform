import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewHomeStudio } from "../new-home-studio";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "电商 KV 生成 | Hemora",
  description: "上传产品参考图，生成电商主KV、详情页和社媒海报视觉。",
};

export default async function KvPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/auth/login?redirectTo=%2Fkv");

  const user = session.user;
  const taskCount = await prisma.generationTask.count({ where: { userId: user.id } });

  return (
    <NewHomeStudio
      mode="kv"
      currentUser={{
        email: user.email,
        displayName: user.displayName ?? "我的账户",
        role: user.role,
        balance: user.wallet?.balance ?? 0,
        taskCount,
      }}
    />
  );
}
