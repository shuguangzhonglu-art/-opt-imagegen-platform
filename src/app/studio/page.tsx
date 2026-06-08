import { NewHomeStudio } from "../new-home-studio";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function StudioPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/auth/login?redirectTo=%2Fstudio");

  const user = session.user;
  const taskCount = await prisma.generationTask.count({ where: { userId: user.id } });

  return (
    <NewHomeStudio
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
