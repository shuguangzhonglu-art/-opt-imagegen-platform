import { prisma } from "@/lib/db";
import { getPlatformConfig, getSizeCost } from "@/lib/config";
import { debitCreditsForTask, refundCreditsForTask } from "@/lib/services/wallet";
import { generateImages } from "@/lib/services/image-provider";
import { checkContentModeration } from "@/lib/services/risk-control";

export async function createGenerationTask(input: {
  userId: string;
  prompt: string;
  sourceImagePath?: string;
  style: string;
  size: string;
  quantity: number;
  quality: string;
}) {
  const config = await getPlatformConfig();
  const unitCost = getSizeCost(config, input.size);
  const totalCost = unitCost * input.quantity;
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });

  await checkContentModeration({
    userId: input.userId,
    userEmail: user?.email,
    endpoint: "queued-generation",
    prompt: input.prompt,
  });

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.generationTask.create({
      data: {
        userId: input.userId,
        prompt: input.prompt,
        sourceImagePath: input.sourceImagePath,
        style: input.style,
        size: input.size,
        quantity: input.quantity,
        quality: input.quality,
        unitCost,
        totalCost,
        status: "PENDING",
      },
    });

    await debitCreditsForTask({
      tx,
      userId: input.userId,
      amount: totalCost,
      taskId: created.id,
      note: `提交生成任务，尺寸 ${input.size}，数量 ${input.quantity}`,
    });

    return created;
  });

  return task;
}

export async function recoverStaleRunningTasks() {
  const recovered = await prisma.generationTask.updateMany({
    where: { status: "RUNNING" },
    data: {
      status: "PENDING",
      startedAt: null,
      errorMessage: "服务重启后自动恢复队列",
    },
  });

  return recovered.count;
}

export async function processNextPendingTask() {
  const nextTask = await prisma.generationTask.findFirst({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
  });

  if (!nextTask) return null;

  const claimed = await prisma.generationTask.updateMany({
    where: { id: nextTask.id, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });

  if (claimed.count === 0) return null;

  try {
    const generated = await generateImages({
      prompt: nextTask.prompt,
      sourceImagePath: nextTask.sourceImagePath ?? undefined,
      style: nextTask.style,
      size: nextTask.size,
      quality: nextTask.quality,
      quantity: nextTask.quantity,
      taskId: nextTask.id,
    });

    await prisma.$transaction(async (tx) => {
      await tx.generatedImage.createMany({
        data: generated.map((image) => ({
          taskId: nextTask.id,
          userId: nextTask.userId,
          filePath: image.filePath,
          width: image.width,
          height: image.height,
        })),
      });

      await tx.generationTask.update({
        where: { id: nextTask.id },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
    });

    return { id: nextTask.id, status: "SUCCESS" as const };
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await refundCreditsForTask({
        tx,
        userId: nextTask.userId,
        amount: nextTask.totalCost,
        taskId: nextTask.id,
        note: "任务失败，自动返还积分",
      });

      await tx.generationTask.update({
        where: { id: nextTask.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : "未知错误",
        },
      });
    });

    return { id: nextTask.id, status: "FAILED" as const };
  }
}
