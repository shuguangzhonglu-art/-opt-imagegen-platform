import { NextResponse } from "next/server";

import { getDirectGenerateTask, processNextDirectGenerateTask, startDirectTaskWorker } from "@/lib/services/direct-tasks";

export async function GET(request: Request) {
  startDirectTaskWorker();
  await processNextDirectGenerateTask();

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

  return NextResponse.json(await getDirectGenerateTask(taskId));
}
