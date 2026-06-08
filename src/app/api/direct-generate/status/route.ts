import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { getDirectGenerateTask } from "@/lib/services/direct-tasks";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      {
        status: "failed",
        error: "请先登录",
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId") || "";

  if (!taskId) {
    return NextResponse.json(
      {
        status: "failed",
        error: "缺少 taskId",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(await getDirectGenerateTask(taskId, session.userId));
}
